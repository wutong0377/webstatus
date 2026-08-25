'use strict';
/**
 * 探测模块（v1.1 增强）
 * 提供 HTTP(S) 探测（含 DNS/TCP/TLS/TTFB 分段计时）、TCP 端口连通检测。
 * 探测前必须经 parseProbeUrl 做 SSRF 校验，连接钉死已校验 IP，防 DNS 重绑定绕过。
 */
const net = require('net');
const tls = require('tls');
const http = require('http');
const { parseProbeUrl } = require('../utils/net');

const UA = 'WebStatus-Monitor/1.0';
const DEFAULT_TIMEOUT = 10000;

/** 将 Node 错误归类为可读错误码 */
function classify(err) {
  const code = err && err.code || '';
  const host = err && err.hostname || '';
  if (code === 'ENOTFOUND') return { code: 'ENOTFOUND', msg: '域名解析失败: ' + host };
  if (code === 'EAI_AGAIN') return { code: 'EAI_AGAIN', msg: 'DNS 临时解析失败' };
  if (code === 'ETIMEDOUT') return { code: 'ETIMEDOUT', msg: '连接/响应超时' };
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
  return { code: 'PROBE_ERROR', msg: (err && err.message) || '探测异常' };
}

/**
 * 单次 HTTP 请求（TCP+TLS+HTTP 分段计时），供 httpProbe 的每一跳调用
 * @param {object} info parseProbeUrl 输出（已过 SSRF 校验，IP 已钉死）
 * @param {number} timeoutMs 超时
 * @returns Promise<{ok, httpCode, delay, errorCode, errorMsg, ip, dnsMs, tcpMs, tlsMs, ttfbMs, location, redirects}>
 */
function httpProbeOnce(info, timeoutMs, prev) {
  return new Promise((resolve) => {
    const out = { ...prev, dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, location: '', ok: false, httpCode: 0, errorCode: '', errorMsg: '' };
    const isHttps = info.url.startsWith('https:');
    let raw;
    let settled = false;
    const finish = (obj) => {
      if (!settled) {
        settled = true;
        if (raw) { try { raw.destroy(); } catch (_) {} }
        resolve(obj);
      }
    };

    // 1) TCP 连接（用已解析 IP，防二次解析）
    const t0 = Date.now();
    connectTcp(info.ip, info.port, timeoutMs).then(sock => {
      raw = sock;
      out.tcpMs = Date.now() - t0;
      // 2) TLS 握手（HTTPS）
      if (isHttps) {
        const t1 = Date.now();
        return upgradeTls(raw, info.host, timeoutMs).then(ts => {
          raw = ts;
          out.tlsMs = Date.now() - t1;
          return sendHttp(ts);
        });
      }
      return sendHttp(sock);
    }).catch(e => {
      const cls = classify(e);
      if (raw) { try { raw.destroy(); } catch (_) {} }
      finish({ ...out, errorCode: cls.code, errorMsg: cls.msg });
    });

    function sendHttp(sock) {
      const t2 = Date.now();
      const req = http.request({
        createConnection: () => sock,
        host: info.host,
        path: info.path,
        method: 'GET',
        headers: { Host: info.host, 'User-Agent': UA, 'Accept': '*/*', 'Cache-Control': 'no-cache', 'Connection': 'close' }
      }, (res) => {
        out.ttfbMs = Date.now() - t2;
        out.httpCode = res.statusCode || 0;
        out.location = String(res.headers.location || '');
        res.resume();
        res.on('end', () => { out.ok = true; finish(out); });
        res.on('error', () => { finish(out); });
      });
      req.on('error', (e) => {
        const cls = classify(e);
        finish({ ...out, errorCode: cls.code, errorMsg: cls.msg });
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        finish({ ...out, errorCode: 'TIMEOUT', errorMsg: '响应超时' });
      });
      req.end();
    }
  });
}

/**
 * HTTP(S) 探测（含分段计时 + 重定向链校验）
 * 跟随最多 5 跳重定向（3xx+Location），检测循环与超限，每跳重新过 SSRF 校验。
 * @param {string} rawUrl 站点 http/https URL
 * @param {number} timeoutMs 超时
 * @returns Promise<{ok, httpCode, delay, errorCode, errorMsg, ip, dnsMs, tcpMs, tlsMs, ttfbMs, location, redirects}>
 */
async function httpProbe(rawUrl, timeoutMs = DEFAULT_TIMEOUT) {
  const start = Date.now();
  const base = {
    ok: false, httpCode: 0, delay: 0, errorCode: '', errorMsg: '', ip: '',
    dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, location: '', redirects: []
  };
  const MAX_REDIRECTS = 5;

  let info;
  try {
    info = await parseProbeUrl(rawUrl); // SSRF 校验 + DNS 解析
  } catch (e) {
    return { ...base, errorCode: e.code || 'PROBE_ERROR', errorMsg: e.message, delay: Date.now() - start };
  }

  let result = { ...base, ip: info.ip };
  let currentUrl = info.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    result = await httpProbeOnce(info, timeoutMs, { ...base, ip: info.ip, redirects: result.redirects });

    // 重定向：3xx 且带 Location
    if (result.ok && result.httpCode >= 300 && result.httpCode < 400 && result.location) {
      const loc = result.location;
      result.redirects.push({ status: result.httpCode, location: loc });
      // 解析下一跳（防相对路径 / 协议-相对 URL）
      let next;
      try { next = new URL(loc, currentUrl).toString(); } catch (e) {
        result.ok = false; result.errorCode = 'REDIRECT_INVALID'; result.errorMsg = '重定向地址无效: ' + loc;
        break;
      }
      if (next === currentUrl) {
        result.ok = false; result.errorCode = 'REDIRECT_LOOP'; result.errorMsg = '检测到重定向循环';
        break;
      }
      try {
        info = await parseProbeUrl(next); // 每一跳重新 SSRF 校验，防重定向到内网
      } catch (e) {
        result.ok = false; result.errorCode = e.code || 'PROBE_ERROR'; result.errorMsg = e.message;
        break;
      }
      currentUrl = info.url;
      result.ip = info.ip;
      result.dnsMs = 0; result.tcpMs = 0; result.tlsMs = 0; result.ttfbMs = 0;
      continue;
    }
    break;
  }

  if (result.redirects.length > MAX_REDIRECTS) {
    result.ok = false; result.errorCode = 'REDIRECT_EXCEED'; result.errorMsg = '重定向次数超过限制（' + MAX_REDIRECTS + '）';
  }
  result.delay = Date.now() - start;
  try { if (result._sock) result._sock.destroy(); } catch (_) {}
  return result;
}

/** 建立 TCP 连接（超时即 reject） */
function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(Object.assign(new Error('TCP 连接超时'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    s.once('connect', () => { clearTimeout(timer); resolve(s); });
    s.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** 将已连接 socket 升级为 TLS（返回 TLSSocket） */
function upgradeTls(socket, servername, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ts = tls.connect({ socket, servername });
    const timer = setTimeout(() => { ts.destroy(); reject(Object.assign(new Error('TLS 握手超时'), { code: 'HANDSHAKE_TIMEOUT' })); }, timeoutMs);
    ts.once('secureConnect', () => { clearTimeout(timer); resolve(ts); });
    ts.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * TCP 端口连通检测（MySQL/Redis/SSH 等服务端口）
 * @param {string} host 主机
 * @param {number} port 端口
 * @param {number} timeoutMs 超时
 * @returns Promise<{ok, delay, errorCode, errorMsg}>
 */
function tcpProbe(host, port, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const timer = setTimeout(() => {
      s.destroy();
      resolve({ ok: false, delay: Date.now() - start, errorCode: 'ETIMEDOUT', errorMsg: '连接超时' });
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(timer); s.destroy();
      resolve({ ok: true, delay: Date.now() - start, errorCode: '', errorMsg: '' });
    });
    s.once('error', (e) => {
      clearTimeout(timer);
      const cls = classify(e);
      resolve({ ok: false, delay: Date.now() - start, errorCode: cls.code, errorMsg: cls.msg });
    });
  });
}

module.exports = { httpProbe, httpProbeOnce, tcpProbe, classify };
