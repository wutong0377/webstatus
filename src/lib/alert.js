'use strict';
/**
 * 统一告警入口（v1.1b）
 * 所有类型告警统一经由此处，依次执行：
 *   1. 站点独立告警开关（alert_enabled）
 *   2. 维护窗口屏蔽（maintenance_windows）
 *   3. 冷却抑制（防轰炸）
 *   4. 写告警日志中心 alert_logs
 *   5. 邮件发送（mailer）
 *   6. Webhook 通用回调（webhooks 表）
 *   7. OneBot QQ（预留配置 + 空调用，不实现完整发送）
 */
const { config } = require('../config');
const { query } = require('../db');
const settingsSvc = require('./settings');
const mailer = require('./mailer');
const { formatDateTime } = require('../utils/time');

const cooldowns = new Map();

/** 冷却抑制判断 */
function inCooldown(key, cooldownSec) {
  const last = cooldowns.get(key) || 0;
  return Date.now() - last < (Number(cooldownSec) || 30) * 1000;
}

/** 站点是否处于维护窗口内（该时段自动屏蔽告警） */
async function inMaintenanceWindow(siteId) {
  if (!siteId) return false;
  const rows = await query(
    'SELECT id FROM maintenance_windows WHERE site_id = ? AND enabled = 1 AND start_at <= NOW() AND end_at >= NOW() LIMIT 1',
    [siteId]
  );
  return rows.length > 0;
}

/** 写告警日志中心 */
async function logAlert(siteId, alertType, level, channel, target, status, errorMsg, payload) {
  await query(
    'INSERT INTO alert_logs (site_id, alert_type, level, channel, target, status, error_msg, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [siteId, alertType, level, channel, String(target || '').slice(0, 200), status,
     String(errorMsg || '').slice(0, 500), String(payload || '').slice(0, 4000), formatDateTime()]
  );
}

/** Webhook 通用回调（POST JSON 到配置地址） */
async function sendWebhooks(siteId, title, content) {
  let hooks = [];
  try { hooks = await query('SELECT id, url, secret FROM webhooks WHERE enabled = 1'); } catch (e) { return; }
  for (const h of hooks) {
    try {
      await fetch(h.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': String(h.secret || '')
        },
        body: JSON.stringify({ siteId, title, content, timestamp: formatDateTime() }),
        signal: AbortSignal.timeout(8000)
      });
      await logAlert(siteId, 'webhook', 2, 'webhook', title, 1, '', '');
    } catch (e) {
      await logAlert(siteId, 'webhook', 2, 'webhook', title, 0, (e && e.message) || 'Webhook 发送失败', '');
    }
  }
}

/**
 * OneBot QQ 机器人（预留通道）
 * 需求明确：仅预留配置（api_url/token/group）与空调用函数，不实现完整发送逻辑。
 * 如需启用，请在此实现 OneBot 协议 API 调用（如 send_group_msg）。
 */
async function sendOneBotReserved(siteId, title, content) {
  const ob = config.onebot || {};
  if (ob.enabled !== true) return;
  // TODO(预留): 调用 OneBot API 推送告警到群/私聊
  // 示例: await fetch(ob.api_url + '/send_group_msg', { ... })
  try {
    await logAlert(siteId, 'qq', 2, 'qq', 'QQ机器人', 1, '', '预留通道（未实现完整发送）');
  } catch (e) { /* ignore */ }
}

/**
 * 发送一条告警
 * @param {object} opts { site, alertType, level(1-3), title, content }
 */
async function sendAlert(opts) {
  const { site, alertType, level = 2, title = '告警', content = '' } = opts;
  const settings = await settingsSvc.getAll();
  const sid = site ? site.id : null;

  // 站点独立关闭告警
  if (site && Number(site.alert_enabled) === 0) return { sent: false, skipped: true };

  // 维护窗口屏蔽
  if (await inMaintenanceWindow(sid)) return { sent: false, skipped: true };

  // 冷却抑制
  const key = alertType + '|' + (sid || 0);
  if (inCooldown(key, settings.alert_cooldown || 30)) return { sent: false, skipped: true };
  cooldowns.set(key, Date.now());

  // 写告警日志中心
  try {
    await logAlert(sid, alertType, level, 'mail', title, 1, '', content);
  } catch (e) { /* 日志失败不影响告警 */ }

  // 邮件
  try { await mailer.sendGeneric(site, { subject: title, html: content, mailType: alertType }); } catch (e) { /* ignore */ }

  // Webhook
  try { await sendWebhooks(sid, title, content); } catch (e) { /* ignore */ }

  // OneBot QQ（预留）
  try { await sendOneBotReserved(sid, title, content); } catch (e) { /* ignore */ }

  return { sent: true, skipped: false };
}

/** 冷却清理（防内存增长） */
function cleanupCooldowns() {
  const now = Date.now();
  for (const [k, t] of cooldowns) {
    if (now - t > 86400000) cooldowns.delete(k);
  }
}
setInterval(cleanupCooldowns, 60 * 60 * 1000).unref();

module.exports = { sendAlert, inMaintenanceWindow };
