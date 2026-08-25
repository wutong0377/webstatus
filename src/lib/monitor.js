'use strict';
/**
 * 巡检任务模块
 * 独立后台定时任务，与 Web 请求彻底解耦：
 *   - 用户访问页面只读已入库结果，不触发任何探测；
 *   - 限制探测并发数（CONCURRENCY），每个探测强制超时；
 *   - 邮件发送走异步队列，不阻塞巡检。
 * 状态处理：
 *   - 抖动抑制：连续 N 次异常才记为故障 / 触发告警；
 *   - 告警冷却：故障持续期间，超过冷却间隔允许再次提醒；
 *   - 维修模式站点完全跳过探测与告警，强制蓝色状态。
 */
const { query } = require('../db');
const { httpProbe, tcpProbe } = require('./probe');
const { ping } = require('./ping');
const { resolveHost } = require('../utils/net');
const { judgeStatus, STATUS } = require('./status');
const settingsSvc = require('./settings');
const mailer = require('./mailer');
const alert = require('./alert');
const { checkDns, checkCert, saveCertCheck, checkSecurityHeaders } = require('./checks');
const { checkDomainExpiry } = require('./whois');
const { formatDateTime } = require('../utils/time');

const CONCURRENCY = 3;        // 最大并发探测数
const PROBE_TIMEOUT = 10000;  // 单次探测超时(ms)

// 内存状态：连续异常计数 / 是否已告警 / 上次告警时间戳
const siteStreaks = new Map();
const siteAlerted = new Map();
const siteLastAlert = new Map();

let stopped = false;
let timer = null;
let running = false;
let lastRunAt = null;
let lastCleanupDay = null; // 上次自动清理的日期（跨天执行一次）
let lastRunResult = { total: 0, up: 0, down: 0, slow: 0, maintenance: 0, errors: [] };

/** 启动巡检循环（递归 setTimeout，间隔动态读取配置） */
function startMonitor() {
  stopped = false;
  timer = setTimeout(loop, 3000); // 服务启动后 3 秒执行首轮
}

/** 巡检主循环 */
async function loop() {
  if (stopped) return;
  await runOnce();
  if (stopped) return;
  const settings = await settingsSvc.getAll().catch(() => null);
  // 每天执行一次过期数据自动清理，防止数据表无限膨胀
  const today = formatDateTime().slice(0, 10);
  if (today !== lastCleanupDay) {
    lastCleanupDay = today;
    cleanupExpired().catch(() => {});
  }
  const interval = Math.max(10, (settings && settings.check_interval) || 60) * 1000;
  timer = setTimeout(loop, interval);
}

/** 停止巡检 */
function stopMonitor() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * 自动清理过期数据
 * 按系统参数：历史数据保留天数、日志保留天数（值为天数，已由 int 校验归一为 Number）
 */
async function cleanupExpired() {
  try {
    const settings = await settingsSvc.getAll();
    const historyDays = Math.max(0, Number(settings.history_retention_days) || 30);
    const logDays = Math.max(0, Number(settings.log_retention_days) || 30);
    if (historyDays > 0) {
      await query('DELETE FROM status_history WHERE checked_at < DATE_SUB(NOW(), INTERVAL ' + historyDays + ' DAY)');
    }
    if (logDays > 0) {
      await query('DELETE FROM mail_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ' + logDays + ' DAY)');
      // 仅清理已结束的故障记录，保留进行中的
      await query('DELETE FROM fault_logs WHERE ended_at IS NOT NULL AND started_at < DATE_SUB(NOW(), INTERVAL ' + logDays + ' DAY)');
    }
    console.log('[monitor] 过期数据自动清理完成（历史 ' + historyDays + ' 天 / 日志 ' + logDays + ' 天）');
  } catch (e) {
    console.error('[monitor] 自动清理失败:', e.message);
  }
}

/** 执行一轮完整巡检（手动触发 / 定时共用） */
async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  lastRunAt = formatDateTime();
  const result = { total: 0, up: 0, down: 0, slow: 0, maintenance: 0, errors: [] };
  try {
    const settings = await settingsSvc.getAll();
    if (!settings.monitor_enabled) {
      running = false;
      lastRunResult = result;
      return result;
    }
    const sites = await query('SELECT * FROM sites WHERE enabled = 1 ORDER BY sort ASC, id ASC');

    // 当前生效的定时维护窗口：到点即生效，命中站点不探测、显示蓝色、耗时 0ms
    const windows = await query(
      'SELECT site_id FROM maintenance_windows WHERE enabled = 1 AND start_at <= NOW() AND end_at >= NOW()'
    ).catch(() => []);
    const windowSiteIds = new Set(windows.map(w => w.site_id));
    const windowSites = sites.filter(s => windowSiteIds.has(s.id));
    const manualMaint = sites.filter(s => s.maintenance === 1);
    const normal = sites.filter(s => s.maintenance !== 1 && !windowSiteIds.has(s.id));
    result.total = sites.length;
    result.maintenance = windowSites.length + manualMaint.length;

    // 定时维护窗口内的站点：写入维修状态(蓝/0ms)，不探测、不计故障、不告警
    for (const s of windowSites) {
      try {
        await query(
          'INSERT INTO status_history (site_id, status, delay, http_code, error_code, error_msg, checked_at, dns_ms, tcp_ms, tls_ms, ttfb_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [s.id, STATUS.MAINTENANCE, 0, null, '', '维护计划生效中', formatDateTime(), 0, 0, 0, 0]
        );
      } catch (e) { /* 忽略写入失败 */ }
    }

    // 分批次并发探测，严格限制并发数
    for (let i = 0; i < normal.length; i += CONCURRENCY) {
      const batch = normal.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(s => checkSite(s, settings, result)));
    }
  } catch (e) {
    result.errors.push(e.message || '巡检异常');
  }
  running = false;
  lastRunResult = result;
  return result;
}

/** 取主机名（去掉协议/路径） */
function hostOf(domain) {
  try { return new URL(domain).hostname; } catch (e) { return String(domain || '').trim(); }
}

/** ICMP 主探测：按 monitor_mode='icmp' 时作为主状态来源（需先过 SSRF 校验） */
async function icmpProbe(domain, timeoutMs) {
  const host = hostOf(domain);
  try {
    const r = await resolveHost(host);
    if (r.blocked) return { ok: false, delay: 0, httpCode: 0, errorCode: 'SSRF_BLOCKED', errorMsg: '目标地址解析到内网/回环地址，已拦截', dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: '' };
  } catch (e) {
    return { ok: false, delay: 0, httpCode: 0, errorCode: 'DNS_FAILED', errorMsg: '域名解析失败: ' + host, dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: '' };
  }
  const p = await ping(host, timeoutMs);
  return {
    ok: p.ok, delay: p.delay, httpCode: 0,
    errorCode: p.ok ? '' : 'PING_FAILED',
    errorMsg: p.ok ? '' : 'ICMP Ping 无响应',
    dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: ''
  };
}

/** TCP 主探测：按 monitor_mode='tcp' 时使用（同样过 SSRF 校验） */
async function tcpSiteProbe(site, timeoutMs) {
  const host = hostOf(site.domain);
  const port = Number(site.tcp_port) || 80;
  try {
    const r = await resolveHost(host);
    if (r.blocked) return { ok: false, delay: 0, httpCode: 0, errorCode: 'SSRF_BLOCKED', errorMsg: '目标地址解析到内网/回环地址，已拦截', dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: '' };
  } catch (e) {
    return { ok: false, delay: 0, httpCode: 0, errorCode: 'DNS_FAILED', errorMsg: '域名解析失败: ' + host, dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: '' };
  }
  const r = await tcpProbe(host, port, timeoutMs);
  return {
    ok: r.ok, delay: r.delay, httpCode: 0,
    errorCode: r.ok ? '' : (r.errorCode || 'TCP_FAILED'),
    errorMsg: r.ok ? '' : ('端口 ' + host + ':' + port + ' 连接失败：' + (r.errorMsg || '')),
    dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, ip: '', location: ''
  };
}

/** 探测单个站点：写历史 + 状态转换处理 */
async function checkSite(site, settings, result) {
  // 按监控模式选择探测方式（http / tcp / icmp）
  let probe;
  if (site.monitor_mode === 'icmp') {
    probe = await icmpProbe(site.domain, PROBE_TIMEOUT);
  } else if (site.monitor_mode === 'tcp') {
    probe = await tcpSiteProbe(site, PROBE_TIMEOUT);
  } else {
    probe = await httpProbe(site.domain, PROBE_TIMEOUT);
    if (probe.ok) {
      // HTTP 模式下异步补充 ping 延迟参考，失败不影响结果
      ping(site.domain).catch(() => {});
    }
  }
  const judged = judgeStatus(probe, settings.slow_threshold, site.expected_status);
  if (judged.status === STATUS.DOWN) result.down++;
  else if (judged.status === STATUS.SLOW) result.slow++;
  else result.up++;

  await query(
    'INSERT INTO status_history (site_id, status, delay, http_code, error_code, error_msg, checked_at, dns_ms, tcp_ms, tls_ms, ttfb_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [site.id, judged.status, probe.delay, judged.httpCode || null, judged.errorCode || '',
     String(judged.errorMsg || probe.errorMsg || '').slice(0, 500), formatDateTime(),
     Math.round(probe.dnsMs || 0), Math.round(probe.tcpMs || 0), Math.round(probe.tlsMs || 0), Math.round(probe.ttfbMs || 0)]
  );
  // 记录最近解析 IP（仅后台可见，前台保密）
  if (probe.ip) {
    await query('UPDATE sites SET last_ip = ? WHERE id = ?', [String(probe.ip).slice(0, 45), site.id]).catch(() => {});
  }

  await processState(site, judged, probe, settings);

  // v1.1 增强检测（证书/DNS/端口），与主状态解耦，异常走统一告警
  await runEnhanceChecks(site).catch(() => {});
}

/**
 * 增强检测：SSL 证书、DNS 记录、TCP 端口
 * 按站点配置执行，结果写入对应表，异常通过统一告警通知。
 */
async function runEnhanceChecks(site) {
  // SSL 证书检测
  if (Number(site.check_cert) === 1) {
    const cert = await checkCert(site);
    await saveCertCheck(site, cert);
    if (cert.status !== 1) {
      await alert.sendAlert({
        site,
        alertType: 'cert',
        level: cert.status === 3 ? 3 : 2,
        title: '【SSL证书告警】' + site.name + ' ' + cert.errorMsg,
        content: '站点 <strong>' + site.name + '</strong>（' + site.domain + '）<br>证书异常：' + cert.errorMsg +
          '<br>签发机构：' + cert.issuer + '<br>有效期至：' + (cert.validTo || '-') + '<br>剩余：' + cert.daysLeft + ' 天'
      });
    }
  }

  // 域名注册到期检测
  if (Number(site.check_domain) === 1) {
    let host = site.domain;
    try { host = new URL(site.domain).hostname; } catch (e) { /* keep */ }
    let dom;
    if (site.domain_expiry_override) {
      // 手动到期日期优先：不依赖 RDAP/WHOIS，保证能算剩余天数发提醒
      const expiry = new Date(String(site.domain_expiry_override));
      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
      dom = { ok: true, status: daysLeft < 0 ? 3 : 1, expiryDate: formatDateTime(expiry), daysLeft, registrar: '手动设置', errorCode: '', errorMsg: '' };
    } else {
      dom = await checkDomainExpiry(host);
    }
    await saveDomainCheck(site, host, dom);
    const warnDays = Number(site.domain_warn_days) || 90;
    if (dom.status !== 1 && (dom.status === 3 || dom.daysLeft <= warnDays)) {
      await alert.sendAlert({
        site,
        alertType: 'domain',
        level: dom.status === 3 ? 3 : 2,
        title: '【域名到期】' + site.name + ' ' + (dom.errorMsg || ('剩余 ' + dom.daysLeft + ' 天')),
        content: '站点 <strong>' + site.name + '</strong>（' + site.domain + '）<br>域名 ' + host + '：' +
          (dom.errorMsg || ('将于 ' + dom.expiryDate + ' 到期，剩余 ' + dom.daysLeft + ' 天'))
      });
    }
  }

  // DNS 记录监控
  if (Number(site.check_dns) === 1) {
    const results = await checkDns(site);
    const bad = results.filter(r => !r.ok);
    if (bad.length) {
      await alert.sendAlert({
        site,
        alertType: 'dns',
        level: 3,
        title: '【DNS异常】' + site.name,
        content: '站点 <strong>' + site.name + '</strong>（' + site.domain + '）<br>DNS 记录与规则不符：' +
          bad.map(r => r.type + '：' + (r.error || ('期望 [' + r.expected.join(', ') + ']，实际 [' + r.actual.join(', ') + ']'))).join('<br>')
      });
    }
  }

  // TCP 端口连通检测
  if (Number(site.check_tcp) === 1 && site.tcp_port) {
    let host;
    try { host = new URL(site.domain).hostname; } catch (e) { host = site.domain; }
    const tcp = await tcpProbe(host, Number(site.tcp_port));
    if (!tcp.ok) {
      await alert.sendAlert({
        site,
        alertType: 'tcp',
        level: 3,
        title: '【端口异常】' + site.name + ':' + site.tcp_port,
        content: '端口 ' + host + ':' + site.tcp_port + ' 连接失败：' + tcp.errorMsg
      });
    }
  }

  // HTTP 安全头巡检（HSTS/CSP/X-Frame-Options 等）
  if (Number(site.check_headers) === 1) {
    const sh = await checkSecurityHeaders(site.domain);
    try {
      await query(
        'INSERT INTO security_checks (site_id, ok, findings, error_code, checked_at) VALUES (?,?,?,?,?)',
        [site.id, sh.ok ? 1 : 0, JSON.stringify(sh.findings || []).slice(0, 4000), sh.errorCode || '', formatDateTime()]
      );
    } catch (_) { /* 记录失败不影响巡检 */ }
    const missing = (sh.findings || []).filter(f => !f.present).map(f => f.header);
    if (sh.ok && missing.length) {
      await alert.sendAlert({
        site,
        alertType: 'headers',
        level: 2,
        title: '【安全头缺失】' + site.name,
        content: '站点 <strong>' + site.name + '</strong>（' + site.domain + '）<br>缺少以下安全响应头：<code>' + missing.join('</code>, <code>') + '</code>'
      });
    }
  }
}

/** 写入域名到期检测记录 */
async function saveDomainCheck(site, host, dom) {
  await query(
    'INSERT INTO domain_checks (site_id, domain, status, expiry_date, days_left, registrar, error_code, checked_at) VALUES (?,?,?,?,?,?,?,?)',
    [site.id, String(host || '').slice(0, 255), dom.status, dom.expiryDate, dom.daysLeft, String(dom.registrar || '').slice(0, 200), dom.errorCode || '', formatDateTime()]
  );
}

/** 抖动抑制 + 故障记录 + 告警逻辑 */
async function processState(site, judged, probe, settings) {
  const sid = site.id;
  const isOk = judged.status === STATUS.UP;

  if (isOk) {
    const hadFault = await closeFaultIfAny(sid);
    // 之前告警过才发送恢复通知
    if (hadFault && siteAlerted.get(sid)) {
      await mailer.sendRecover(site);
      siteAlerted.set(sid, false);
    }
    siteStreaks.set(sid, 0);
    return;
  }

  // 异常：累计连续异常次数
  const streak = (siteStreaks.get(sid) || 0) + 1;
  siteStreaks.set(sid, streak);

  // 达到抖动抑制阈值才记录故障 / 告警
  if (streak >= Number(settings.alert_streak)) {
    await ensureFaultOpen(sid, judged);
    const now = Date.now();
    const lastAlert = siteLastAlert.get(sid) || 0;
    const cooldownMs = Math.max(0, Number(settings.alert_cooldown) || 0) * 1000;
    // 冷却期外允许再次提醒
    if (!siteAlerted.get(sid) || (now - lastAlert) >= cooldownMs) {
      await mailer.sendAlert(site, judged, probe);
      siteAlerted.set(sid, true);
      siteLastAlert.set(sid, now);
    }
  }
}

/** 确保存在进行中的故障记录 */
async function ensureFaultOpen(sid, judged) {
  const rows = await query('SELECT id FROM fault_logs WHERE site_id = ? AND ended_at IS NULL LIMIT 1', [sid]);
  if (rows.length) return rows[0];
  await query(
    'INSERT INTO fault_logs (site_id, fault_status, http_code, error_code, error_msg, started_at, duration_sec) VALUES (?,?,?,?,?,?,0)',
    [sid, judged.status, judged.httpCode || null, judged.errorCode || '',
     String(judged.errorMsg || '').slice(0, 500), formatDateTime()]
  );
}

/** 关闭进行中的故障记录，返回是否存在 */
async function closeFaultIfAny(sid) {
  const rows = await query('SELECT id, started_at FROM fault_logs WHERE site_id = ? AND ended_at IS NULL LIMIT 1', [sid]);
  if (!rows.length) return false;
  const f = rows[0];
  const duration = Math.max(0, Math.round((Date.now() - new Date(f.started_at).getTime()) / 1000));
  await query('UPDATE fault_logs SET ended_at = ?, duration_sec = ? WHERE id = ?', [formatDateTime(), duration, f.id]);
  return true;
}

/**
 * 获取全部站点及最新一次状态（公开接口缓存源）
 * 维修模式强制蓝色；从未探测过的站点 last_status 为 null。
 */
async function getSitesLatest() {
  // 注意：这里只查询稳定的基础字段 + 最新状态，绝不依赖 cert_checks / domain_checks 等
  // 增强检测表（v2.1.0 曾把子查询写进来，导致这些表/列缺失时整个接口 500、前台全空）。
  // 证书/域名状态由 attachSecurityStatus() 单独、容错地附加。
  const rows = await query(`
    SELECT s.id, s.name, s.domain, s.description, s.seo_title, s.seo_desc, s.seo_keywords,
           s.icon_url, s.enabled, s.maintenance, s.maintenance_note, s.sort,
           h.status AS last_status, h.delay AS last_delay, h.http_code AS last_http_code,
           h.error_code AS last_error_code, h.error_msg AS last_error_msg, h.checked_at AS last_checked_at
    FROM sites s
    LEFT JOIN (
      SELECT sh.* FROM status_history sh
      JOIN (SELECT site_id, MAX(id) AS maxid FROM status_history GROUP BY site_id) m
        ON sh.id = m.maxid
    ) h ON h.site_id = s.id
    ORDER BY s.sort ASC, s.id ASC
  `);
  // 定时维护窗口：命中站点的状态实时置为维修(蓝)，无需等下一轮巡检
  const windows = await query(
    'SELECT site_id FROM maintenance_windows WHERE enabled = 1 AND start_at <= NOW() AND end_at >= NOW()'
  ).catch(() => []);
  const winIds = new Set(windows.map(w => w.site_id));
  return rows.map(r => {
    let status = null;
    if (r.maintenance === 1 || winIds.has(r.id)) status = STATUS.MAINTENANCE;
    else if (r.last_status) status = r.last_status;
    return { ...r, status };
  });
}

/**
 * 批量附加各站点最新证书/域名状态（容错：表或列缺失时静默返回空，绝不影响主查询/主流程）
 * @param {Array<object>} sites 站点数组
 * @returns {Promise<Array<object>>}
 */
async function attachSecurityStatus(sites) {
  if (!sites || !sites.length) return sites;
  const ids = sites.map(s => s.id);
  const inClause = ids.map(() => '?').join(',');
  const [certs, domains] = await Promise.all([
    query(
      'SELECT c.site_id, c.status FROM cert_checks c WHERE c.id IN (SELECT MAX(id) FROM cert_checks WHERE site_id IN (' + inClause + ') GROUP BY site_id)',
      ids
    ).catch(() => []),
    query(
      'SELECT d.site_id, d.status FROM domain_checks d WHERE d.id IN (SELECT MAX(id) FROM domain_checks WHERE site_id IN (' + inClause + ') GROUP BY site_id)',
      ids
    ).catch(() => [])
  ]);
  const certMap = {};
  const domMap = {};
  for (const c of certs) certMap[c.site_id] = c.status;
  for (const d of domains) domMap[d.site_id] = d.status;
  return sites.map(s => ({
    ...s,
    cert_status: certMap[s.id] != null ? certMap[s.id] : null,
    domain_status: domMap[s.id] != null ? domMap[s.id] : null
  }));
}

/** 服务运行状态（后台"查看服务运行状态"） */
function getServiceStatus() {
  return {
    running: !stopped,
    inRound: running,
    lastRunAt,
    lastRun: lastRunResult,
    streakCount: siteStreaks.size
  };
}

/** 最近一次巡检结果 */
function getLastResult() { return lastRunResult; }

/** 删除站点时清理内存状态（站点被删除后调用，防 Map 无界增长） */
function removeSiteMemory(sid) {
  siteStreaks.delete(sid);
  siteAlerted.delete(sid);
  siteLastAlert.delete(sid);
}

module.exports = { startMonitor, stopMonitor, runOnce, getSitesLatest, attachSecurityStatus, getServiceStatus, getLastResult, removeSiteMemory };
