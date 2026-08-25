'use strict';
/**
 * v1.1 增强检测模块
 * DNS 记录监控、SSL 证书检测、HTTP 安全头巡检。
 * 这些检测与主 HTTP 巡检解耦，由巡检任务按站点配置（check_dns/check_cert/check_tcp）调用。
 */
const net = require('net');
const dns = require('dns').promises;
const tls = require('tls');
const http = require('http');
const { query } = require('../db');
const { parseProbeUrl } = require('../utils/net');
const { formatDateTime } = require('../utils/time');

// OCSP 吊销检测依赖 ocsp 库（可选）；未安装时自动降级为"无法校验"，不崩溃
let ocspLib = null;
try { ocspLib = require('ocsp'); } catch (e) { ocspLib = null; }

const UA = 'WebStatus-Monitor/1.0';

/**
 * DNS 记录监控：校验 A/AAAA/CNAME/MX 记录是否符合规则
 * @param {object} site 站点
 * @returns Promise<Array<{ruleId, type, ok, actual, expected, error}>>
 */
async function checkDns(site) {
  const rules = await query('SELECT id, record_type, expected FROM dns_rules WHERE site_id = ?', [site.id]);
  let host;
  try { host = new URL(site.domain).hostname; } catch (e) { host = site.domain; }
  const results = [];
  for (const rule of rules) {
    const type = rule.record_type;
    let actual = [];
    try {
      if (type === 'A') actual = (await dns.resolve4(host)).slice().sort();
      else if (type === 'AAAA') actual = (await dns.resolve6(host)).slice().sort();
      else if (type === 'CNAME') actual = await dns.resolveCname(host);
      else if (type === 'MX') { const r = await dns.resolveMx(host); actual = r.map(m => m.exchange).sort(); }
      else continue;
    } catch (e) {
      results.push({ ruleId: rule.id, type, ok: false, actual: [], expected: parseExpected(rule.expected), error: '解析失败: ' + (e.code || e.message) });
      continue;
    }
    const expected = parseExpected(rule.expected);
    const ok = expected.length === 0 || expected.every(v => actual.includes(v));
    results.push({ ruleId: rule.id, type, ok, actual, expected, error: '' });
  }
  return results;
}

/** 解析期望记录值（每行一条） */
function parseExpected(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * SSL 证书检测：签发信息 / SAN / 有效期 / 过期预警
 * @param {object} site 站点
 * @returns Promise<{status:1|2|3, issuer, subject, san[], validFrom, validTo, daysLeft, errorCode, errorMsg}>
 */
async function checkCert(site, timeoutMs = 8000) {
  let host, port;
  try {
    const u = new URL(site.domain);
    host = u.hostname;
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch (e) {
    host = site.domain;
    port = 443;
  }
  const warnDays = Number(site.cert_warn_days) || 30;
  const out = { status: 1, issuer: '', subject: '', san: [], validFrom: null, validTo: null, daysLeft: 0, errorCode: '', errorMsg: '', _rawCert: null, _rawIssuer: null };

  return await new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      try {
        const cert = socket.getPeerCertificate(true);
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86400000) : 0;
        // 保留原始证书（DER）供 OCSP 吊销检测使用（仅内部使用，不入库不外传）
        out._rawCert = cert.raw || null;
        out._rawIssuer = (cert.issuerCertificate && cert.issuerCertificate.raw) ? cert.issuerCertificate.raw : null;
        out.issuer = (cert.issuer && cert.issuer.CN) || '';
        out.subject = (cert.subject && cert.subject.CN) || '';
        out.san = String(cert.subjectaltname || '').split(/,\s?/).filter(Boolean);
        out.validFrom = validFrom ? formatDateTime(validFrom) : null;
        out.validTo = validTo ? formatDateTime(validTo) : null;
        out.daysLeft = daysLeft;
        if (daysLeft < 0) {
          out.status = 3; out.errorCode = 'CERT_HAS_EXPIRED'; out.errorMsg = '证书已过期 ' + (-daysLeft) + ' 天';
        } else if (daysLeft <= warnDays) {
          out.status = 2; out.errorCode = 'CERT_WARN'; out.errorMsg = '证书 ' + daysLeft + ' 天后过期';
        }
      } catch (e) {
        out.status = 3; out.errorCode = 'CERT_PARSE'; out.errorMsg = '证书解析失败';
      }
      try { socket.end(); } catch (e) { /* ignore */ }
      resolve(out);
    });
    socket.on('error', (e) => {
      out.status = 3; out.errorCode = e.code || 'SSL_ERROR'; out.errorMsg = e.message || '证书检测失败';
      resolve(out);
    });
    socket.setTimeout(timeoutMs, () => {
      try { socket.destroy(); } catch (e) { /* ignore */ }
      out.status = 3; out.errorCode = 'CERT_TIMEOUT'; out.errorMsg = '证书检测超时';
      resolve(out);
    });
  });
}

/** 写入证书检测记录 */
async function saveCertCheck(site, cert) {
  await query(
    'INSERT INTO cert_checks (site_id, status, issuer, subject, san, valid_from, valid_to, days_left, error_code, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [site.id, cert.status, cert.issuer, cert.subject, JSON.stringify(cert.san || []), cert.validFrom, cert.validTo, cert.daysLeft, cert.errorCode || '', formatDateTime()]
  );
}

/** 获取最新一条证书检测结果 */
async function getLatestCert(siteId) {
  const rows = await query('SELECT * FROM cert_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', [siteId]);
  return rows[0] || null;
}

/**
 * HTTP 安全头巡检（SSRF 安全版）
 * 先经 parseProbeUrl 做 SSRF 校验并钉死已解析 IP，再发起请求，防 DNS 重绑定。
 * @param {string} url 站点 URL
 * @returns Promise<{ok, headers:object, findings:Array<{header, present}>}>
 */
function checkSecurityHeaders(url, timeoutMs = 10000) {
  const HEADERS = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'];
  return new Promise((resolve) => {
    parseProbeUrl(url).then(info => {
      const isHttps = info.url.startsWith('https:');
      const sock = net.connect({ host: info.ip, port: info.port });
      const finish = (out) => { try { sock.destroy(); } catch (_) {} resolve(out); };
      sock.once('connect', () => {
        const doRequest = (socket) => {
          const req = http.request({
            createConnection: () => socket,
            host: info.host,
            path: info.path,
            method: 'GET',
            headers: { Host: info.host, 'User-Agent': UA, 'Accept': '*/*', 'Connection': 'close' }
          }, (res) => {
            const headers = res.headers || {};
            const findings = HEADERS.map(h => ({ header: h, present: headers[h] !== undefined }));
            res.resume();
            res.on('end', () => finish({ ok: true, headers, findings }));
          });
          req.on('error', (e) => finish({ ok: false, headers: {}, findings: [], errorCode: e.code || 'PROBE_ERROR', errorMsg: e.message }));
          req.setTimeout(timeoutMs, () => { req.destroy(); finish({ ok: false, headers: {}, findings: [], errorCode: 'TIMEOUT', errorMsg: '超时' }); });
          req.end();
        };
        if (isHttps) {
          const ts = tls.connect({ socket: sock, servername: info.host }, () => doRequest(ts));
          ts.on('error', (e) => finish({ ok: false, headers: {}, findings: [], errorCode: e.code || 'TLS_ERROR', errorMsg: e.message }));
        } else {
          doRequest(sock);
        }
      });
      sock.on('error', (e) => finish({ ok: false, headers: {}, findings: [], errorCode: e.code || 'PROBE_ERROR', errorMsg: e.message }));
    }).catch(e => {
      resolve({ ok: false, headers: {}, findings: [], errorCode: e.code || 'PROBE_ERROR', errorMsg: e.message });
    });
  });
}

/**
 * OCSP 证书吊销检测
 * 需要 ocsp 依赖与完整证书链（签发者证书）；任一缺失时返回 status=2（无法校验，不误报）。
 * @param {Buffer|null} rawCert 证书 DER
 * @param {Buffer|null} rawIssuer 签发者证书 DER
 * @returns Promise<{status(1未吊销|2无法校验|3已吊销), revoked, errorCode, errorMsg}>
 */
function checkOcsp(rawCert, rawIssuer) {
  return new Promise((resolve) => {
    const out = { status: 1, revoked: false, errorCode: '', errorMsg: '' };
    if (!ocspLib) {
      out.status = 2; out.errorCode = 'OCSP_DISABLED'; out.errorMsg = 'ocsp 依赖未安装，已跳过吊销检测';
      return resolve(out);
    }
    if (!rawCert || !rawIssuer) {
      out.status = 2; out.errorCode = 'OCSP_NO_ISSUER'; out.errorMsg = '缺少签发者证书，无法进行吊销检测';
      return resolve(out);
    }
    try {
      ocspLib.verify({ cert: rawCert, issuer: rawIssuer }, (err, res) => {
        if (err) {
          out.status = 2; out.errorCode = 'OCSP_ERROR'; out.errorMsg = (err && err.message) || 'OCSP 校验失败';
          return resolve(out);
        }
        if (res && res.revoked) {
          out.status = 3; out.revoked = true; out.errorCode = 'CERT_REVOKED'; out.errorMsg = '证书已被吊销';
          return resolve(out);
        }
        out.status = 1; out.revoked = false;
        resolve(out);
      });
    } catch (e) {
      out.status = 2; out.errorCode = 'OCSP_EXCEPTION'; out.errorMsg = (e && e.message) || 'OCSP 校验异常';
      resolve(out);
    }
  });
}

module.exports = { checkDns, checkCert, saveCertCheck, getLatestCert, checkSecurityHeaders, checkOcsp, parseExpected };
