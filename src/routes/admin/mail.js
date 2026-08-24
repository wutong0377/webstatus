'use strict';
/**
 * 邮件告警设置接口
 *  - SMTP 配置（敏感凭证写 config.json，不回显密码明文）
 *  - 接收告警邮箱增删改（格式校验）
 *  - 全局告警总开关
 *  - 邮件模板编辑 / 重置默认
 *  - 发送测试邮件
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../db');
const { config, saveConfig } = require('../../config');
const mailer = require('../../lib/mailer');
const settingsSvc = require('../../lib/settings');
const tplSvc = require('../../lib/templates');
const { requiredStr, str, email, int, bool } = require('../../utils/validate');

/* ================= SMTP 配置 ================= */
router.get('/config', (req, res) => {
  const s = config.smtp;
  res.json({
    code: 0,
    data: {
      enabled: s.enabled === true,
      host: s.host || '',
      port: s.port || 465,
      secure: s.secure === true,
      user: s.user || '',
      from_name: s.from_name || '',
      from_email: s.from_email || '',
      pass_masked: s.pass ? '******' : ''
    }
  });
});

router.post('/config', (req, res, next) => {
  try {
    const s = req.body || {};
    const cur = config.smtp;
    const nextCfg = {
      enabled: bool(s.enabled),
      host: str(s.host, 200, 'SMTP 服务器'),
      port: int(s.port, { min: 1, max: 65535, name: '端口' }),
      secure: bool(s.secure),
      user: str(s.user, 200, '发件账号'),
      pass: (s.pass && String(s.pass) !== '') ? String(s.pass) : cur.pass, // 留空保留原密码
      from_name: str(s.from_name, 100, '发件人名称'),
      from_email: s.from_email ? email(s.from_email, '发件邮箱') : cur.from_email
    };
    saveConfig({ smtp: nextCfg });
    mailer.createTransporter();
    res.json({ code: 0, message: 'SMTP 配置已保存' });
  } catch (e) { next(e); }
});

/* ---------------- 发送测试邮件 ---------------- */
router.post('/test', async (req, res, next) => {
  try {
    let to = (req.body && req.body.to_email) ? email(req.body.to_email, '测试收件人') : (config.smtp.from_email || '');
    if (!to) return res.status(400).json({ code: 400, message: '请指定测试收件邮箱，或先配置发件邮箱' });
    const result = await mailer.sendTestEmail(to);
    res.json(result.ok ? { code: 0, message: result.message } : { code: 400, message: result.message });
  } catch (e) { next(e); }
});

/* ================= 全局告警总开关 ================= */
router.get('/state', async (req, res, next) => {
  try {
    const settings = await settingsSvc.getAll();
    res.json({ code: 0, data: { monitorEnabled: settings.monitor_enabled === true } });
  } catch (e) { next(e); }
});

router.post('/toggle-alert', async (req, res, next) => {
  try {
    const enabled = bool(req.body && req.body.enabled);
    await settingsSvc.setMany({ monitor_enabled: enabled });
    res.json({ code: 0, message: enabled ? '告警已开启' : '告警已关闭' });
  } catch (e) { next(e); }
});

/* ================= 接收邮箱 ================= */
router.get('/recipients', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await query('SELECT id, email, enabled, created_at FROM recipients ORDER BY id ASC') });
  } catch (e) { next(e); }
});

router.post('/recipients/create', async (req, res, next) => {
  try {
    const mail = email(req.body && req.body.email, '接收邮箱');
    try {
      await query('INSERT INTO recipients (email, enabled) VALUES (?,?)', [mail, 1]);
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ code: 400, message: '该邮箱已存在' });
      throw e;
    }
    res.json({ code: 0, message: '接收邮箱已添加' });
  } catch (e) { next(e); }
});

router.post('/recipients/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const enabled = bool(req.body && req.body.enabled);
    await query('UPDATE recipients SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    res.json({ code: 0, message: '已更新' });
  } catch (e) { next(e); }
});

router.post('/recipients/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM recipients WHERE id = ?', [Number(req.params.id)]);
    res.json({ code: 0, message: '已删除' });
  } catch (e) { next(e); }
});

/* ================= 邮件模板 ================= */
router.get('/templates', async (req, res, next) => {
  try {
    const rows = await query('SELECT tpl_type, subject, html FROM mail_templates ORDER BY tpl_type ASC');
    res.json({ code: 0, data: rows, vars: tplSvc.TEMPLATE_VARS });
  } catch (e) { next(e); }
});

router.post('/templates/save', async (req, res, next) => {
  try {
    const body = req.body || {};
    const type = String(body.tpl_type || '');
    if (!['alert', 'recover'].includes(type)) return res.status(400).json({ code: 400, message: '模板类型不正确' });
    const subject = requiredStr(body.subject, 200, '邮件主题');
    const html = str(body.html, 20000, '邮件正文');
    await tplSvc.save(type, subject, html);
    res.json({ code: 0, message: '模板已保存' });
  } catch (e) { next(e); }
});

router.post('/templates/reset', async (req, res, next) => {
  try {
    const type = String((req.body && req.body.tpl_type) || '');
    if (!['alert', 'recover'].includes(type)) return res.status(400).json({ code: 400, message: '模板类型不正确' });
    await tplSvc.reset(type);
    res.json({ code: 0, message: '已重置为默认模板' });
  } catch (e) { next(e); }
});

module.exports = router;
