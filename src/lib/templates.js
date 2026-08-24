'use strict';
/**
 * 邮件模板服务
 * 提供告警模板 / 恢复通知模板的读取、保存、重置默认，以及模板变量渲染。
 * 渲染规则：仅替换 {{变量}} 占位符并转义变量值，模板自身的 HTML 不受影响。
 */
const { query } = require('../db');
const { escapeHtml } = require('../utils/html');

/** 模板变量说明（后台编辑器展示） */
const TEMPLATE_VARS = [
  { key: 'site_name', desc: '站点显示名称' },
  { key: 'site_domain', desc: '站点域名' },
  { key: 'site_desc', desc: '站点简介' },
  { key: 'status', desc: '状态文本（正常/卡顿/离线/维修）' },
  { key: 'delay', desc: '响应耗时(ms)' },
  { key: 'http_code', desc: 'HTTP 状态码' },
  { key: 'error_explain', desc: '错误解读' },
  { key: 'occur_time', desc: '发生时间' }
];

/** 默认模板 */
const DEFAULT_TEMPLATES = {
  alert: {
    subject: '【WebStatus 告警】{{site_name}} 状态异常',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'Microsoft YaHei',sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <div style="background:#dc2626;padding:16px 24px;color:#ffffff;">
      <h2 style="margin:0;font-size:18px;">站点状态告警</h2>
    </div>
    <div style="padding:24px;font-size:14px;color:#334155;">
      <p>站点 <strong>{{site_name}}</strong>（<a href="{{site_domain}}">{{site_domain}}</a>）检测到状态异常，请及时关注。</p>
      <p style="font-size:12px;color:#64748b;margin-top:-4px;">{{site_desc}}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:10px;background:#f8fafc;width:120px;border:1px solid #e2e8f0;">当前状态</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{status}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">响应耗时</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{delay}} ms</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">HTTP 状态码</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{http_code}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">错误解读</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{error_explain}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">发生时间</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{occur_time}}</td>
        </tr>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:20px;">此邮件由 WebStatus 网站状态监控系统自动发送。</p>
    </div>
  </div>
</body>
</html>`
  },
  recover: {
    subject: '【WebStatus 恢复】{{site_name}} 已恢复正常',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'Microsoft YaHei',sans-serif;">
  <div style="max-width:600px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
    <div style="background:#16a34a;padding:16px 24px;color:#ffffff;">
      <h2 style="margin:0;font-size:18px;">站点已恢复正常</h2>
    </div>
    <div style="padding:24px;font-size:14px;color:#334155;">
      <p>站点 <strong>{{site_name}}</strong>（<a href="{{site_domain}}">{{site_domain}}</a>）已恢复正常访问。</p>
      <p style="font-size:12px;color:#64748b;margin-top:-4px;">{{site_desc}}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:10px;background:#f8fafc;width:120px;border:1px solid #e2e8f0;">当前状态</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{status}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">响应耗时</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{delay}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">恢复说明</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{error_explain}}</td>
        </tr>
        <tr>
          <td style="padding:10px;background:#f8fafc;border:1px solid #e2e8f0;">通知时间</td>
          <td style="padding:10px;border:1px solid #e2e8f0;">{{occur_time}}</td>
        </tr>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:20px;">此邮件由 WebStatus 网站状态监控系统自动发送。</p>
    </div>
  </div>
</body>
</html>`
  }
};

/**
 * 渲染模板：替换 {{var}}，可选转义变量值
 * @param {string} tpl 模板文本
 * @param {object} data 变量数据
 * @param {boolean} escape 是否 HTML 转义变量值
 */
function renderTemplate(tpl, data, escape = true) {
  return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const v = data[key];
    if (v === undefined || v === null) return '';
    return escape ? escapeHtml(String(v)) : String(v);
  });
}

/** 获取指定类型模板；首次使用自动写入默认模板 */
async function get(type) {
  let rows = await query('SELECT subject, html FROM mail_templates WHERE tpl_type = ?', [type]);
  if (!rows.length) {
    await ensureDefaults();
    rows = await query('SELECT subject, html FROM mail_templates WHERE tpl_type = ?', [type]);
  }
  return rows[0];
}

/** 确保默认模板存在（不覆盖用户已改的模板，仅补缺失） */
async function ensureDefaults() {
  for (const type of Object.keys(DEFAULT_TEMPLATES)) {
    const rows = await query('SELECT tpl_type FROM mail_templates WHERE tpl_type = ?', [type]);
    if (!rows.length) {
      await query('INSERT INTO mail_templates (tpl_type, subject, html) VALUES (?,?,?)',
        [type, DEFAULT_TEMPLATES[type].subject, DEFAULT_TEMPLATES[type].html]);
    }
  }
}

/** 保存模板（后台编辑器） */
async function save(type, subject, html) {
  await query('UPDATE mail_templates SET subject = ?, html = ? WHERE tpl_type = ?', [subject, html, type]);
}

/** 重置为默认模板 */
async function reset(type) {
  await query('UPDATE mail_templates SET subject = ?, html = ? WHERE tpl_type = ?',
    [DEFAULT_TEMPLATES[type].subject, DEFAULT_TEMPLATES[type].html, type]);
}

module.exports = { DEFAULT_TEMPLATES, TEMPLATE_VARS, renderTemplate, get, save, reset, ensureDefaults };
