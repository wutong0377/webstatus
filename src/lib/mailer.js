'use strict';
/**
 * SMTP 邮件告警模块
 *   - 凭证明文仅存于 config.json（不入数据库）；
 *   - 异步发送队列：不阻塞巡检任务；
 *   - 每次发送记录到 mail_logs；
 *   - 发送测试邮件（后台按钮）。
 */
const nodemailer = require('nodemailer');
const { config } = require('../config');
const { query } = require('../db');
const settingsSvc = require('./settings');
const tplSvc = require('./templates');
const { getErrorExplain } = require('../data/errorCodes');
const { formatDateTime } = require('../utils/time');
const { STATUS_TEXT } = require('./status');

let transporter = null;

/** 根据 config.smtp 创建 transporter */
function createTransporter() {
  const smtp = config.smtp;
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 465,
    secure: smtp.secure === true,
    auth: (smtp.user && smtp.pass) ? { user: smtp.user, pass: smtp.pass } : undefined,
    tls: { rejectUnauthorized: false }
  });
  return transporter;
}

function getTransporter() { return transporter; }

/** 发件人地址 */
function sender() {
  const smtp = config.smtp;
  return `"${smtp.from_name || 'WebStatus'}" <${smtp.from_email || smtp.user || 'webstatus@localhost'}>`;
}

// ---------------- 异步发送队列 ----------------
const queue = [];
let processing = false;

function enqueue(mail) {
  queue.push(mail);
  if (!processing) { processing = true; processQueue(); }
}

async function processQueue() {
  while (queue.length) {
    const mail = queue.shift();
    try {
      await transporter.sendMail(mail.options);
      await logMail(mail.to, mail.mailType, 1, '');
    } catch (e) {
      await logMail(mail.to, mail.mailType, 0, (e && e.message) || '发送失败');
    }
  }
  processing = false;
}

/** 写邮件发送日志 */
async function logMail(toEmail, mailType, status, errorMsg) {
  await query(
    'INSERT INTO mail_logs (to_email, mail_type, status, error_msg, created_at) VALUES (?,?,?,?,?)',
    [toEmail, mailType, status, String(errorMsg || '').slice(0, 500), formatDateTime()]
  );
}

/** 获取启用中的接收邮箱 */
async function getEnabledRecipients() {
  return query('SELECT email FROM recipients WHERE enabled = 1 ORDER BY id ASC');
}

/**
 * 向全部启用邮箱发送邮件
 * @param {object} site     站点对象
 * @param {string} mailType alert / recover
 * @param {object} data     模板变量
 */
async function sendToRecipients(site, mailType, data) {
  const settings = await settingsSvc.getAll();
  if (!settings.monitor_enabled) return;
  if (!config.smtp.enabled || !transporter) return;
  const recipients = await getEnabledRecipients();
  if (!recipients.length) return;

  const tmpl = await tplSvc.get(mailType);
  const subject = tplSvc.renderTemplate(tmpl.subject, data, false); // 主题不转义 HTML
  const html = tplSvc.renderTemplate(tmpl.html, data, true);        // 正文变量转义
  for (const r of recipients) {
    enqueue({ to: r.email, mailType, options: { from: sender(), to: r.email, subject, html } });
  }
}

/** 发送告警邮件 */
async function sendAlert(site, judged, probe) {
  const explain = getErrorExplain(judged.errorCode, judged.errorMsg);
  await sendToRecipients(site, 'alert', {
    site_name: site.name,
    site_domain: site.domain,
    site_desc: site.description,
    status: STATUS_TEXT[judged.status] || '异常',
    delay: String(probe.delay),
    http_code: judged.httpCode ? String(judged.httpCode) : '-',
    error_explain: explain.name + '：' + explain.cause,
    occur_time: formatDateTime()
  });
}

/** 发送恢复通知 */
async function sendRecover(site) {
  await sendToRecipients(site, 'recover', {
    site_name: site.name,
    site_domain: site.domain,
    site_desc: site.description,
    status: '正常',
    delay: '-',
    http_code: '-',
    error_explain: '站点已恢复正常访问',
    occur_time: formatDateTime()
  });
}

/** 发送测试邮件（后台设置页） */
async function sendTestEmail(toEmail) {
  if (!transporter) createTransporter();
  const subject = '【WebStatus】SMTP 测试邮件';
  const html = '<p>这是一封来自 WebStatus 的测试邮件。</p><p>如果您收到本邮件，说明 SMTP 配置正确。</p>';
  try {
    await transporter.sendMail({ from: sender(), to: toEmail, subject, html });
    await logMail(toEmail, 'test', 1, '');
    return { ok: true, message: '测试邮件已发送' };
  } catch (e) {
    await logMail(toEmail, 'test', 0, (e && e.message) || '发送失败');
    return { ok: false, message: (e && e.message) || '发送失败，请检查 SMTP 配置' };
  }
}

module.exports = { createTransporter, getTransporter, sendAlert, sendRecover, sendTestEmail, sendToRecipients };
