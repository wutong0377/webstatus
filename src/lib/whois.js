'use strict';
/**
 * 域名注册到期检测（RDAP 方案）
 * 通过 RDAP（Registry Data Access Protocol）查询域名注册信息获取过期时间。
 * RDAP 返回结构化 JSON，比传统 WHOIS 文本解析更可靠，走 HTTPS，无需额外依赖。
 * 数据源：https://rdap.org/domain/{domain}（注册局 RDAP 引导服务器）。
 */
const { formatDateTime } = require('../utils/time');

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';

/**
 * 查询域名注册到期信息
 * @param {string} domain 纯域名（如 example.com，会自动规范化）
 * @param {number} timeoutMs 超时毫秒
 * @returns Promise<{ok, status(1正常|2预警|3异常), expiryDate, daysLeft, registrar, errorCode, errorMsg}>
 */
async function checkDomainExpiry(domain, timeoutMs = 8000) {
  const out = {
    ok: false, status: 1, expiryDate: null, daysLeft: 0, registrar: '',
    errorCode: '', errorMsg: ''
  };
  // 规范化：去掉协议/路径，只留域名
  const clean = String(domain || '').trim().replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(clean)) {
    out.status = 3; out.errorCode = 'DOMAIN_INVALID'; out.errorMsg = '域名格式不正确';
    return out;
  }
  try {
    const res = await fetch(RDAP_BOOTSTRAP + encodeURIComponent(clean), {
      headers: { 'Accept': 'application/rdap+json', 'User-Agent': 'WebStatus-Monitor/1.0' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      out.status = 3; out.errorCode = 'RDAP_HTTP_' + res.status; out.errorMsg = 'RDAP 查询失败（' + res.status + '）';
      return out;
    }
    const data = await res.json();

    // 找 expiration 事件
    let expiry = null;
    if (Array.isArray(data.events)) {
      const ev = data.events.find(e => e.eventAction === 'expiration');
      if (ev && ev.eventDate) expiry = new Date(ev.eventDate);
    }
    if (!expiry || isNaN(expiry.getTime())) {
      out.status = 2; out.errorCode = 'DOMAIN_NO_EXPIRY'; out.errorMsg = 'RDAP 未返回过期时间';
      return out;
    }

    const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
    out.ok = true;
    out.expiryDate = formatDateTime(expiry);
    out.daysLeft = daysLeft;
    // 注册商：取 entities 里第一个 vcardArray 的组织名（尽力而为）
    if (Array.isArray(data.entities)) {
      const ent = data.entities.find(e => e.roles && e.roles.includes('registrar')) || data.entities[0];
      if (ent && Array.isArray(ent.vcardArray) && ent.vcardArray[1]) {
        const fn = ent.vcardArray[1].find(v => v[0] === 'fn');
        if (fn && fn[3]) out.registrar = String(fn[3]).slice(0, 200);
      }
    }
    if (daysLeft < 0) {
      out.status = 3; out.errorCode = 'DOMAIN_EXPIRED'; out.errorMsg = '域名已过期 ' + (-daysLeft) + ' 天';
    }
    return out;
  } catch (e) {
    out.status = 3; out.errorCode = 'RDAP_FAILED'; out.errorMsg = 'RDAP 查询失败: ' + (e && e.message || '网络错误');
    return out;
  }
}

module.exports = { checkDomainExpiry };
