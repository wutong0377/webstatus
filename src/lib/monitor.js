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
const { httpProbe } = require('./probe');
const { ping } = require('./ping');
const { judgeStatus, STATUS } = require('./status');
const settingsSvc = require('./settings');
const mailer = require('./mailer');
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
    const normal = sites.filter(s => s.maintenance !== 1); // 维修模式不探测
    result.total = sites.length;
    result.maintenance = sites.length - normal.length;

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

/** 探测单个站点：写历史 + 状态转换处理 */
async function checkSite(site, settings, result) {
  const probe = await httpProbe(site.domain, PROBE_TIMEOUT);
  if (probe.ok) {
    // 异步补充 ping 延迟参考，失败不影响结果
    ping(site.domain).catch(() => {});
  }
  const judged = judgeStatus(probe, settings.slow_threshold);
  if (judged.status === STATUS.DOWN) result.down++;
  else if (judged.status === STATUS.SLOW) result.slow++;
  else result.up++;

  await query(
    'INSERT INTO status_history (site_id, status, delay, http_code, error_code, error_msg, checked_at) VALUES (?,?,?,?,?,?,?)',
    [site.id, judged.status, probe.delay, judged.httpCode || null, judged.errorCode || '',
     String(judged.errorMsg || probe.errorMsg || '').slice(0, 500), formatDateTime()]
  );

  await processState(site, judged, probe, settings);
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
  return rows.map(r => {
    let status = null;
    if (r.maintenance === 1) status = STATUS.MAINTENANCE;
    else if (r.last_status) status = r.last_status;
    return { ...r, status };
  });
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

module.exports = { startMonitor, stopMonitor, runOnce, getSitesLatest, getServiceStatus, getLastResult, removeSiteMemory };
