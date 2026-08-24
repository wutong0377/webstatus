'use strict';
/**
 * 网络工具：SSRF 防护、域名规范化
 * 核心原则：探测目标必须 DNS 解析成 IP 后校验，禁止探测内网/回环/保留地址。
 */
const net = require('net');
const dns = require('dns').promises;

/**
 * 判断 IP 是否为内网 / 回环 / 保留地址（SSRF 黑名单）
 * @param {string} ip IPv4 / IPv6 地址
 * @returns {boolean} true 表示禁止访问
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                                     // 10.0.0.0/8
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;        // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;                    // 192.168.0.0/16
    if (p[0] === 127) return true;                                    // 回环
    if (p[0] === 0) return true;                                      // 0.0.0.0/8
    if (p[0] === 169 && p[1] === 254) return true;                    // link-local
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;       // CGNAT 100.64.0.0/10
    if (p[0] >= 224) return true;                                     // 组播 / 保留
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::' ) return true;                  // 回环 / 未指定
    if (low.startsWith('::ffff:127')) return true;                    // IPv4 映射回环
    if (low.startsWith('fe80')) return true;                          // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true;    // ULA 唯一本地
    return false;
  }
  return false;
}

/**
 * 解析主机为 IP 并检测是否内网
 * @param {string} host 主机名
 * @returns {Promise<{host:string, ip:string, blocked:boolean}>}
 */
async function resolveHost(host) {
  const ip = await dns.lookup(host, { all: false });
  return { host, ip, blocked: isPrivateIp(ip) };
}

/**
 * 校验探测 URL 并做 SSRF 防护
 * @param {string} rawUrl http/https URL
 * @returns {Promise<{url:string, host:string, ip:string}>} 通过校验的可探测 URL 信息
 */
async function parseProbeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (e) {
    const err = new Error('站点 URL 格式不正确');
    err.code = 'URL_INVALID';
    throw err;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const err = new Error('仅支持 http/https 协议');
    err.code = 'URL_PROTOCOL';
    throw err;
  }
  const host = u.hostname;
  let resolved;
  try {
    resolved = await resolveHost(host);
  } catch (e) {
    const err = new Error('域名解析失败: ' + host);
    err.code = 'DNS_FAILED';
    throw err;
  }
  if (resolved.blocked) {
    const err = new Error('目标地址解析到内网/回环地址，已拦截（SSRF 防护）');
    err.code = 'SSRF_BLOCKED';
    throw err;
  }
  return {
    url: u.toString(),
    host,
    ip: resolved.ip,
    port: u.port || (u.protocol === 'https:' ? 443 : 80)
  };
}

/** 站点域名规范化：自动补全 http:// */
function normalizeDomain(input) {
  let d = String(input || '').trim();
  if (!d) throw new Error('站点域名不能为空');
  if (!/^https?:\/\//i.test(d)) d = 'http://' + d;
  return d;
}

/** 校验站点域名：http(s)、hostname 非空（探测前的二次校验交给 parseProbeUrl） */
function validateMonitorDomain(input) {
  const d = normalizeDomain(input);
  let u;
  try {
    u = new URL(d);
  } catch (e) {
    throw new Error('站点域名格式不正确');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https 站点');
  if (!u.hostname) throw new Error('站点域名不能为空');
  return d;
}

module.exports = { isPrivateIp, resolveHost, parseProbeUrl, normalizeDomain, validateMonitorDomain };
