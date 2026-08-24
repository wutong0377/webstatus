'use strict';
/**
 * 统一告警入口（v1.1）
 * 所有类型告警（故障/恢复/证书/DNS/端口等）都经由这里：
 *   - 写入告警日志中心 alert_logs；
 *   - 按冷却时间抑制重复轰炸；
 *   - 尊重站点"独立关闭告警"开关；
 *   - 通过 mailer 发送邮件。
 * 后续版本在此之上扩展：告警分级、Webhook、OneBot QQ、维护窗口屏蔽。
 */
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

/**
 * 发送一条告警
 * @param {object} opts
 *   site      站点对象（可为 null）
 *   alertType 告警类型 down/recover/cert/dns/tcp/...
 *   level     1警告 2严重 3紧急
 *   title     标题（写入 target 字段与邮件主题）
 *   content   内容（HTML，写入 payload）
 * @returns {Promise<{sent:boolean, skipped:boolean}>}
 */
async function sendAlert(opts) {
  const { site, alertType, level = 2, title = '告警', content = '' } = opts;
  const settings = await settingsSvc.getAll();
  const sid = site ? site.id : null;

  // 站点独立关闭告警
  if (site && Number(site.alert_enabled) === 0) return { sent: false, skipped: true };

  // 冷却抑制（同一类型+站点）
  const key = alertType + '|' + (sid || 0);
  if (inCooldown(key, settings.alert_cooldown || 30)) return { sent: false, skipped: true };
  cooldowns.set(key, Date.now());

  // 写告警日志中心
  try {
    await query(
      'INSERT INTO alert_logs (site_id, alert_type, level, channel, target, status, error_msg, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [sid, alertType, level, 'mail', String(title).slice(0, 200), 1, '', String(content).slice(0, 4000), formatDateTime()]
    );
  } catch (e) { /* 日志写入失败不影响告警 */ }

  // 邮件发送（SMTP 未启用则静默跳过）
  try {
    await mailer.sendGeneric(site, { subject: title, html: content, mailType: alertType });
  } catch (e) { /* ignore */ }

  return { sent: true, skipped: false };
}

/** 告警冷却状态清理（防内存增长） */
function cleanupCooldowns() {
  const now = Date.now();
  for (const [k, t] of cooldowns) {
    if (now - t > 86400000) cooldowns.delete(k);
  }
}
setInterval(cleanupCooldowns, 60 * 60 * 1000).unref();

module.exports = { sendAlert };
