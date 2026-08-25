'use strict';
/**
 * 告警体系管理接口（v1.1b）
 * 告警日志中心、Webhook 配置、维护窗口、OneBot QQ 预留配置。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');
const { config, saveConfig } = require('../../config');
const { requiredStr, str, bool } = require('../../utils/validate');

/* ============ 告警日志中心 ============ */
router.get('/logs', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(50, Math.max(1, Number(req.query.size) || 15));
    const siteId = String(req.query.site_id || '').trim();
    const type = String(req.query.type || '').trim();
    const level = String(req.query.level || '').trim();
    const where = [];
    const params = [];
    if (siteId) { where.push('a.site_id = ?'); params.push(Number(siteId)); }
    if (type && type !== 'all') { where.push('a.alert_type = ?'); params.push(type); }
    if (level && level !== 'all') { where.push('a.level = ?'); params.push(Number(level)); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = await queryOne('SELECT COUNT(*) AS c FROM alert_logs a ' + whereSql, params);
    const limit = size;
    const offset = (page - 1) * size;
    const rows = await query(
      'SELECT a.*, s.name AS site_name FROM alert_logs a LEFT JOIN sites s ON a.site_id = s.id ' + whereSql + ' ORDER BY a.id DESC LIMIT ' + limit + ' OFFSET ' + offset,
      params
    );
    res.json({ code: 0, data: rows, total: Number(total.c), page, size });
  } catch (e) { next(e); }
});

/* ============ Webhook 配置 ============ */
router.get('/webhooks', async (req, res, next) => {
  try {
    const rows = await query('SELECT id, name, url, enabled, secret FROM webhooks ORDER BY id ASC');
    const data = rows.map(r => ({ id: r.id, name: r.name, url: r.url, enabled: r.enabled, secret_masked: r.secret ? '******' : '' }));
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

router.post('/webhooks/create', async (req, res, next) => {
  try {
    const name = requiredStr(req.body && req.body.name, 100, '名称');
    const url = str(req.body && req.body.url, 500, 'URL');
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ code: 400, message: 'Webhook URL 需以 http(s):// 开头' });
    const secret = str(req.body && req.body.secret, 200, '密钥');
    const enabled = bool(req.body && req.body.enabled);
    await query('INSERT INTO webhooks (name, url, enabled, secret) VALUES (?,?,?,?)', [name, url, enabled ? 1 : 0, secret]);
    res.json({ code: 0, message: 'Webhook 已添加' });
  } catch (e) { next(e); }
});

router.post('/webhooks/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const name = requiredStr(req.body && req.body.name, 100, '名称');
    const url = str(req.body && req.body.url, 500, 'URL');
    const enabled = bool(req.body && req.body.enabled);
    const cur = await queryOne('SELECT secret FROM webhooks WHERE id = ?', [id]);
    const secret = (req.body && req.body.secret) ? String(req.body.secret) : (cur ? cur.secret : '');
    await query('UPDATE webhooks SET name=?, url=?, enabled=?, secret=? WHERE id=?', [name, url, enabled ? 1 : 0, secret, id]);
    res.json({ code: 0, message: 'Webhook 已更新' });
  } catch (e) { next(e); }
});

router.post('/webhooks/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM webhooks WHERE id = ?', [Number(req.params.id)]);
    res.json({ code: 0, message: '已删除' });
  } catch (e) { next(e); }
});

/* ============ 维护窗口 ============ */
router.get('/windows', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await query('SELECT w.*, s.name AS site_name FROM maintenance_windows w LEFT JOIN sites s ON w.site_id = s.id ORDER BY w.id DESC') });
  } catch (e) { next(e); }
});

router.post('/windows/create', async (req, res, next) => {
  try {
    const siteId = Number((req.body && req.body.site_id) || 0);
    const title = requiredStr(req.body && req.body.title, 100, '标题');
    const startAt = str(req.body && req.body.start_at, 30, '开始时间');
    const endAt = str(req.body && req.body.end_at, 30, '结束时间');
    if (!startAt || !endAt) return res.status(400).json({ code: 400, message: '请填写开始/结束时间' });
    await query('INSERT INTO maintenance_windows (site_id, title, start_at, end_at, enabled) VALUES (?,?,?,?,1)', [siteId, title, startAt, endAt]);
    res.json({ code: 0, message: '维护窗口已添加' });
  } catch (e) { next(e); }
});

router.post('/windows/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const siteId = Number((req.body && req.body.site_id) || 0);
    const title = requiredStr(req.body && req.body.title, 100, '标题');
    const startAt = str(req.body && req.body.start_at, 30, '开始时间');
    const endAt = str(req.body && req.body.end_at, 30, '结束时间');
    const enabled = bool(req.body && req.body.enabled);
    await query('UPDATE maintenance_windows SET site_id=?, title=?, start_at=?, end_at=?, enabled=? WHERE id=?', [siteId, title, startAt, endAt, enabled ? 1 : 0, id]);
    res.json({ code: 0, message: '已更新' });
  } catch (e) { next(e); }
});

router.post('/windows/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM maintenance_windows WHERE id = ?', [Number(req.params.id)]);
    res.json({ code: 0, message: '已删除' });
  } catch (e) { next(e); }
});

/* ============ OneBot QQ 预留配置 ============ */
router.get('/onebot', (req, res) => {
  const ob = config.onebot || {};
  res.json({
    code: 0,
    data: {
      enabled: ob.enabled === true,
      api_url: ob.api_url || '',
      group: ob.group || '',
      private_uid: ob.private_uid || '',
      token_masked: ob.token ? '******' : ''
    }
  });
});

router.post('/onebot', (req, res, next) => {
  try {
    const b = req.body || {};
    const cur = config.onebot || {};
    saveConfig({
      onebot: {
        enabled: bool(b.enabled),
        api_url: str(b.api_url, 500, 'API 地址'),
        token: (b.token && String(b.token) !== '') ? String(b.token) : cur.token,
        group: str(b.group, 100, '目标群号'),
        private_uid: str(b.private_uid, 100, '私聊目标 QQ')
      }
    });
    res.json({ code: 0, message: 'OneBot 配置已保存（预留通道）' });
  } catch (e) { next(e); }
});

/* ============ 极验人机验证配置（前台「获取最新情况」防滥用） ============ */
router.get('/geetest', (req, res) => {
  const gt = config.geetest || {};
  res.json({
    code: 0,
    data: {
      enabled: gt.enabled === true,
      captcha_id: gt.captcha_id || '',
      key_masked: gt.captcha_key ? '******' : ''
    }
  });
});

router.post('/geetest', (req, res, next) => {
  try {
    const b = req.body || {};
    const cur = config.geetest || {};
    saveConfig({
      geetest: {
        enabled: bool(b.enabled),
        captcha_id: str(b.captcha_id, 100, '极验 ID'),
        captcha_key: (b.captcha_key && String(b.captcha_key) !== '') ? String(b.captcha_key) : cur.captcha_key
      }
    });
    res.json({ code: 0, message: '极验配置已保存' });
  } catch (e) { next(e); }
});

module.exports = router;
