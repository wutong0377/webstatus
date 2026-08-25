'use strict';
/**
 * 公开接口（无需登录）
 * 只读已入库结果，绝不触发探测/ping；带内存缓存与 IP 限流。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const cache = require('../lib/cache');
const settingsSvc = require('../lib/settings');
const { getSitesLatest } = require('../lib/monitor');
const { downsample } = require('../lib/downsample');
const { STATUS_TEXT } = require('../lib/status');
const { rateLimit } = require('../middleware/rateLimit');

// 公开接口 IP 限流
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, message: '请求过于频繁，请稍后再试' }));

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 时间范围边界 */
function rangeBound(range) {
  const now = new Date();
  const DAY = 86400 * 1000;
  let fromMs = now.getTime() - 24 * 3600 * 1000;
  if (range === 'hour') fromMs = now.getTime() - 3600 * 1000;
  if (range === 'week') fromMs = now.getTime() - 7 * DAY;
  if (range === 'month') fromMs = now.getTime() - 30 * DAY;
  return { from: fmt(new Date(fromMs)), to: fmt(now) };
}

/** 状态变更点（相邻状态不同的记录） */
async function getStatusChanges(siteId, from, to) {
  const rows = await query(
    'SELECT checked_at, status, delay, error_code, error_msg FROM status_history WHERE site_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC, id ASC',
    [siteId, from, to]
  );
  const changes = [];
  let prev = null;
  for (const r of rows) {
    if (r.status !== prev) {
      changes.push(r);
      prev = r.status;
    }
  }
  return changes;
}

/* ---------------- 全部站点最新状态 ---------------- */
router.get('/status', async (req, res, next) => {
  try {
    const settings = await settingsSvc.getAll();
    const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
    let data = cache.get('pub_status');
    if (!data) {
      data = await getSitesLatest();
      cache.set('pub_status', data, ttl);
    }
    res.json({ code: 0, data, refresh: Number(settings.frontend_refresh) || 30 });
  } catch (e) { next(e); }
});

/* ---------------- 站点详情（曲线 + 时间线 + 故障记录） ---------------- */
router.get('/site/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const site = await queryOne('SELECT * FROM sites WHERE id = ?', [id]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });

    // 附带最新一次探测结果（last_*），供详情页顶部指标展示
    const last = await queryOne(
      'SELECT status, delay, http_code, error_code, error_msg, checked_at FROM status_history WHERE site_id = ? ORDER BY id DESC LIMIT 1',
      [id]
    );
    if (last) {
      site.last_status = last.status;
      site.last_delay = last.delay;
      site.last_http_code = last.http_code;
      site.last_error_code = last.error_code;
      site.last_error_msg = last.error_msg;
      site.last_checked_at = last.checked_at;
    } else {
      site.last_status = null;
      site.last_delay = null;
      site.last_http_code = null;
      site.last_error_code = null;
      site.last_error_msg = null;
      site.last_checked_at = null;
    }
    // 统一 status：维修模式强制 4，否则取最新探测状态
    site.status = site.maintenance === 1 ? 4 : (site.last_status || null);

    const range = ['hour', 'day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'day';
    const settings = await settingsSvc.getAll();
    const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
    const cacheKey = 'pub_site_' + id + '_' + range;
    let data = cache.get(cacheKey);
    if (!data) {
      const { from, to } = rangeBound(range);
      const [historyRows, changeRows, faultRows] = await Promise.all([
        query('SELECT checked_at, status, delay, http_code, error_code FROM status_history WHERE site_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC', [id, from, to]),
        getStatusChanges(id, from, to),
        query('SELECT id, fault_status, http_code, error_code, error_msg, started_at, ended_at, duration_sec FROM fault_logs WHERE site_id = ? ORDER BY started_at DESC LIMIT 50', [id])
      ]);
      data = {
        site,
        chart: downsample(historyRows, 200),
        changes: changeRows,
        faults: faultRows.map(f => ({
          ...f,
          status_text: STATUS_TEXT[f.fault_status] || '异常'
        }))
      };
      cache.set(cacheKey, data, ttl);
    }
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 迷你时间线（卡片内状态预览，批量） ---------------- */
router.get('/mini-timeline', async (req, res, next) => {
  try {
    const ids = String(req.query.id || '').split(',').map(s => Number(s.trim())).filter(n => n > 0).slice(0, 10);
    if (!ids.length) return res.json({ code: 0, data: {} });
    const cacheKey = 'pub_mini_' + ids.join('_');
    let data = cache.get(cacheKey);
    if (!data) {
      const settings = await settingsSvc.getAll();
      const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
      data = {};
      for (const sid of ids) {
        const rows = await query('SELECT status, checked_at FROM status_history WHERE site_id = ? ORDER BY id DESC LIMIT 12', [sid]);
        data[sid] = rows.reverse();
      }
      cache.set(cacheKey, data, ttl);
    }
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 公告列表 ---------------- */
router.get('/notices', async (req, res, next) => {
  try {
    let data = cache.get('pub_notices');
    if (!data) {
      data = await query('SELECT id, title, content, is_pinned FROM notices ORDER BY is_pinned DESC, sort ASC, id DESC LIMIT 20');
      cache.set('pub_notices', data, 10000);
    }
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 站点历史 CSV 导出 ---------------- */
router.get('/site/:id/export', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const site = await queryOne('SELECT id, name FROM sites WHERE id = ?', [id]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });
    const rows = await query(
      'SELECT checked_at, status, delay, http_code, error_code, error_msg FROM status_history WHERE site_id = ? ORDER BY checked_at ASC, id ASC',
      [id]
    );
    const header = ['时间', '状态', '延迟(ms)', 'HTTP状态码', '错误码', '错误信息'];
    const lines = rows.map(r => [
      r.checked_at,
      STATUS_TEXT[r.status] || r.status,
      r.delay,
      r.http_code || '',
      r.error_code || '',
      '"' + String(r.error_msg || '').replace(/"/g, '""') + '"'
    ].join(','));
    // BOM 便于 Excel 识别 UTF-8
    const csv = '﻿' + header.join(',') + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="webstatus-site-' + id + '-history.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

module.exports = router;
