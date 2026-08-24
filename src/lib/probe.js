'use strict';
/**
 * HTTP 探测模块
 * 负责获取目标站点的 HTTP 状态码与响应耗时。
 * 探测前必须经过 parseProbeUrl 的 SSRF 防护校验（内网/回环地址一律拦截）。
 */
const http = require('http');
const https = require('https');
const { parseProbeUrl } = require('../utils/net');

const DEFAULT_TIMEOUT = 10000;
const UA = 'WebStatus-Monitor/1.0';

/**
 * 探测单个站点
 * @param {string} rawUrl 站点 http/https URL
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<{ok:boolean, httpCode:number, delay:number, errorCode:string, errorMsg:string, ip:string}>}
 */
async function httpProbe(rawUrl, timeoutMs = DEFAULT_TIMEOUT) {
  const start = Date.now();
  try {
    const info = await parseProbeUrl(rawUrl);
    const mod = info.url.startsWith('https:') ? https : http;

    return await new Promise((resolve) => {
      // 直接连接已校验的 IP，禁止二次 DNS 解析（防 DNS rebinding / TOCTOU 绕过 SSRF）
      const req = mod.get({
        hostname: info.ip,
        port: info.port,
        path: info.path,
        servername: info.host, // TLS SNI 使用真实主机名
        timeout: timeoutMs,
        headers: { Host: info.host, 'User-Agent': UA, 'Accept': '*/*', 'Cache-Control': 'no-cache' }
      }, (res) => {
        res.resume(); // 消费响应体以完成连接
        const delay = Date.now() - start;
        resolve({ ok: true, httpCode: res.statusCode || 0, delay, errorCode: '', errorMsg: '', ip: info.ip });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, httpCode: 0, delay: Date.now() - start, errorCode: 'TIMEOUT', errorMsg: '连接或响应超时', ip: info.ip });
      });

      req.on('error', (err) => {
        const cls = classifyError(err);
        resolve({ ok: false, httpCode: 0, delay: Date.now() - start, errorCode: cls.code, errorMsg: cls.msg, ip: info.ip });
      });
    });
  } catch (err) {
    // parseProbeUrl 抛出的错误（URL 非法 / SSRF 拦截 / DNS 失败）
    const code = err.code || 'PROBE_ERROR';
    return { ok: false, httpCode: 0, delay: Date.now() - start, errorCode: code, errorMsg: err.message, ip: '' };
  }
}

/** 将 Node 错误对象归类为可读的错误码 */
function classifyError(err) {
  const code = err.code || '';
  if (code === 'ENOTFOUND') return { code: 'ENOTFOUND', msg: '域名解析失败: ' + (err.hostname || '') };
  if (code === 'EAI_AGAIN') return { code: 'EAI_AGAIN', msg: 'DNS 临时解析失败' };
  if (code === 'ETIMEDOUT') return { code: 'ETIMEDOUT', msg: '连接超时' };
  if (code === 'ECONNREFUSED') return { code: 'ECONNREFUSED', msg: '连接被拒绝' };
  if (code === 'ECONNRESET') return { code: 'ECONNRESET', msg: '连接被重置' };
  if (code === 'EHOSTUNREACH') return { code: 'EHOSTUNREACH', msg: '主机不可达' };
  if (code === 'ENETUNREACH') return { code: 'ENETUNREACH', msg: '网络不可达' };
  if (String(code).startsWith('CERT_')) return { code, msg: 'SSL 证书错误: ' + code };
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return { code, msg: 'SSL 证书校验失败: ' + code };
  }
  if (code === 'ERR_SSL_PROTOCOL_ERROR' || code === 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE') {
    return { code, msg: 'SSL 握手失败: ' + code };
  }
  if (code === 'ERR_SOCKET_TIMEOUT') return { code: 'ERR_SOCKET_TIMEOUT', msg: '套接字超时' };
  if (code) return { code, msg: '网络错误: ' + code };
  return { code: 'PROBE_ERROR', msg: err.message || '探测异常' };
}

module.exports = { httpProbe, classifyError };
