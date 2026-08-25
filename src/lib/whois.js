'use strict';
/**
 * 域名注册到期检测（RDAP + WHOIS 双链路）
 * 顺序：直连注册局 RDAP（绕开 rdap.org 引导不稳定，尤其 .cn）→ rdap.org 引导 → WHOIS 文本兜底。
 * 全部失败时归类为「无法获取到期信息」（状态=2 预警，不标红异常），不再暴露 RDAP_HTTP_404 等裸错误码。
 */
const net = require('net');
const { formatDateTime } = require('../utils/time');

// 常见 TLD 的注册局 RDAP 直连地址
const RDAP_SERVERS = {
  cn: 'https://rdap.cnnic.cn/domain/',
  'com.cn': 'https://rdap.cnnic.cn/domain/',
  'net.cn': 'https://rdap.cnnic.cn/domain/',
  'org.cn': 'https://rdap.cnnic.cn/domain/',
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
  info: 'https://rdap.afilias.info/rdap/domain/',
  io: 'https://rdap.nic.io/domain/',
  xyz: 'https://rdap.donuts.xyz/domain/'
};

// WHOIS 服务器映射（RDAP 失败兜底）
const WHOIS_SERVERS = {
  cn: 'whois.cnnic.cn',
  'com.cn': 'whois.cnnic.cn',
  'net.cn': 'whois.cnnic.cn',
  'org.cn': 'whois.cnnic.cn',
  com: 'whois.verisign-grs.com',
  net: 'whois.verisign-grs.com',
  org: 'whois.publicinterestregistry.org',
  info: 'whois.afilias.info',
  io: 'whois.nic.io',
  xyz: 'whois.nic.xyz'
};

/** 提取 TLD（优先二级后缀，如 com.cn / net.cn） */
function tldOf(domain) {
  const labels = String(domain || '').split('.');
  if (labels.length >= 3) {
    const sld = labels[labels.length - 2] + '.' + labels[labels.length - 1];
    if (RDAP_SERVERS[sld] || WHOIS_SERVERS[sld]) return sld;
  }
  return labels[labels.length - 1];
}

/** RDAP GET（跟随重定向，超时即抛错） */
async function rdapQuery(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { Accept: 'application/rdap+json', 'User-Agent': 'WebStatus-Monitor/2.0' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error('RDAP HTTP ' + res.status);
  return res.json();
}

/** WHOIS 文本查询（43 端口） */
function whoisQuery(domain, server, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: server, port: 43, timeout: timeoutMs });
    let data = '';
    sock.on('connect', () => sock.write(domain + '\r\n'));
    sock.on('data', d => { data += d.toString(); if (data.length > 20000) { try { sock.destroy(); } catch (_) {} } });
    sock.on('end', () => resolve(data));
    sock.on('close', () => resolve(data));
    sock.on('error', reject);
    sock.setTimeout(timeoutMs, () => { try { sock.destroy(); } catch (_) {} reject(Object.assign(new Error('WHOIS 超时'), { code: 'ETIMEDOUT' })); });
  });
}

/** 从 WHOIS 文本解析到期时间 */
function parseWhoisExpiry(text) {
  const re = /(?:Expir\w+ Date|Expiration Time|Registrar Registration Expiration Date)\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[T ]?[0-9:]{0,8}Z?)/i;
  const m = String(text || '').match(re);
  if (!m) return null;
  const d = new Date(m[1].trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** 解析 RDAP JSON → 结果对象 */
function parseRdap(data, out) {
  let expiry = null;
  if (Array.isArray(data.events)) {
    const ev = data.events.find(e => e.eventAction === 'expiration');
    if (ev && ev.eventDate) expiry = new Date(ev.eventDate);
  }
  if (!expiry || isNaN(expiry.getTime())) {
    out.status = 2; out.errorCode = 'DOMAIN_NO_EXPIRY'; out.errorMsg = '注册局未返回到期时间';
    return out;
  }
  const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
  out.ok = true;
  out.expiryDate = formatDateTime(expiry);
  out.daysLeft = daysLeft;
  if (Array.isArray(data.entities)) {
    const ent = data.entities.find(e => e.roles && e.roles.includes('registrar')) || data.entities[0];
    if (ent && Array.isArray(ent.vcardArray) && ent.vcardArray[1]) {
      const fn = ent.vcardArray[1].find(v => v[0] === 'fn');
      if (fn && fn[3]) out.registrar = String(fn[3]).slice(0, 200);
    }
  }
  out.status = daysLeft < 0 ? 3 : 1;
  return out;
}

/**
 * 查询域名注册到期信息
 * @param {string} domain 纯域名
 * @param {number} timeoutMs 超时
 */
async function checkDomainExpiry(domain, timeoutMs = 8000) {
  const out = { ok: false, status: 1, expiryDate: null, daysLeft: 0, registrar: '', errorCode: '', errorMsg: '' };
  const clean = String(domain || '').trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(clean)) {
    out.status = 3; out.errorCode = 'DOMAIN_INVALID'; out.errorMsg = '域名格式不正确';
    return out;
  }
  const tld = tldOf(clean);

  // 1) 直连注册局 RDAP（绕开 rdap.org，尤其 .cn）
  const direct = RDAP_SERVERS[tld];
  if (direct) {
    try {
      return parseRdap(await rdapQuery(direct + encodeURIComponent(clean), timeoutMs), out);
    } catch (e) { /* 直连失败，尝试下一层 */ }
  }

  // 2) rdap.org 引导
  try {
    return parseRdap(await rdapQuery('https://rdap.org/domain/' + encodeURIComponent(clean), timeoutMs), out);
  } catch (e) { /* 失败，尝试 WHOIS */ }

  // 3) WHOIS 文本兜底
  const whoisServer = WHOIS_SERVERS[tld];
  if (whoisServer) {
    try {
      const text = await whoisQuery(clean, whoisServer, timeoutMs);
      const expiry = parseWhoisExpiry(text);
      if (expiry) {
        const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
        out.ok = true;
        out.expiryDate = formatDateTime(expiry);
        out.daysLeft = daysLeft;
        out.status = daysLeft < 0 ? 3 : 1;
        return out;
      }
    } catch (e) { /* 忽略 */ }
  }

  // 全部失败：归类为"无法获取到期信息"，不标红异常
  out.status = 2;
  out.errorCode = 'DOMAIN_LOOKUP_UNAVAILABLE';
  out.errorMsg = '该域名注册局暂不支持自动查询，请到注册商后台查看到期时间';
  return out;
}

module.exports = { checkDomainExpiry };
