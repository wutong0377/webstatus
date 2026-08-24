'use strict';
/**
 * 报表接口
 *   - GET /availability?site_id=&days=7|30|90   按天可用率（status=1 次数 / 总次数）
 *   - GET /blocks?site_id=&days=7              按小时状态方块图数据（取主导状态）
 *   - GET /manual-faults                       手动故障分页列表
 *   - POST /manual-faults/create|update|delete 手动故障增删改
 *   - GET /export?site_id=&days=30             CSV 导出（可用率汇总 + 最近故障）
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');
const { str, requiredStr, bool } = require('../../utils/validate');

const DAYS_AVAIL = [7, 30, 90];

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

/** 起始日期（含今天在内共 days 天）的 'YYYY-MM-DD' 形式 */
function sinceDate(days) {
  const now = new Date();
  now.setDate(now.getDate() - (days - 1));
  return fmtDate(now);
}

function pickDays(v, def) {
  let days = Number(v) || def;
  if (!DAYS_AVAIL.includes(days)) days = def;
  return days;
}

/** 填充完整的日期序列（缺数据的日期返回 null） */
function buildDateSeries(days, map) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - (days - 1 - i));
    const key = fmtDate(dt);
    const e = map[key];
    out.push({ date: key, availability: e && e.total > 0 ? Math.round((e.ok / e.total) * 10000) / 100 : null });
  }
  return out;
}

/* ---------------- 按天可用率 ---------------- */
router.get('/availability', async (req, res, next) => {
  try {
    const siteId = Number(req.query.site_id || 0);
    if (!siteId) return res.status(400).json({ code: 400, message: '请选择站点' });
    const days = pickDays(req.query.days, 7);
    const since = sinceDate(days) + ' 00:00:00';

    const rows = await query(
      `SELECT DATE_FORMAT(checked_at, '%Y-%m-%d') AS d, SUM(status = 1) AS ok, COUNT(*) AS total
       FROM status_history
       WHERE site_id = ? AND checked_at >= ?
       GROUP BY DATE_FORMAT(checked_at, '%Y-%m-%d')`,
      [siteId, since]
    );
    const map = {};
    rows.forEach(r => { map[String(r.d)] = { ok: Number(r.ok), total: Number(r.total) }; });
    res.json({ code: 0, data: buildDateSeries(days, map) });
  } catch (e) { next(e); }
});

/* ---------------- 按小时状态方块图 ---------------- */
router.get('/blocks', async (req, res, next) => {
  try {
    const siteId = Number(req.query.site_id || 0);
    if (!siteId) return res.status(400).json({ code: 400, message: '请选择站点' });
    const days = pickDays(req.query.days, 7);
    const since = sinceDate(days) + ' 00:00:00';

    const rows = await query(
      `SELECT DATE_FORMAT(checked_at, '%Y-%m-%d %H:00') AS h, status, COUNT(*) AS c
       FROM status_history
       WHERE site_id = ? AND checked_at >= ?
       GROUP BY DATE_FORMAT(checked_at, '%Y-%m-%d %H:00'), status`,
      [siteId, since]
    );
    // 每个小时取计数最多的状态作为主导状态；并列时优先异常状态
    const best = {};
    for (const r of rows) {
      const key = String(r.h);
      const status = Number(r.status);
      const c = Number(r.c);
      const cur = best[key];
      if (!cur || c > cur.c || (c === cur.c && status !== 1)) {
        best[key] = { status, c };
      }
    }
    // 补齐缺失小时（无数据 → 0 未检测）
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - i);
      const day = fmtDate(dt);
      for (let h = 0; h < 24; h++) {
        const key = day + ' ' + pad(h) + ':00';
        out.push({ time: key, status: best[key] ? best[key].status : 0 });
      }
    }
    res.json({ code: 0, data: out });
  } catch (e) { next(e); }
});

/* ---------------- 手动故障：列表 ---------------- */
router.get('/manual-faults', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(50, Math.max(1, Number(req.query.size) || 15));
    const total = await queryOne('SELECT COUNT(*) AS c FROM manual_faults');
    const rows = await query(
      'SELECT m.*, s.name AS site_name FROM manual_faults m LEFT JOIN sites s ON m.site_id = s.id ORDER BY m.id DESC LIMIT ? OFFSET ?',
      [size, (page - 1) * size]
    );
    res.json({ code: 0, data: rows, total: Number(total.c), page, size });
  } catch (e) { next(e); }
});

/* ---------------- 手动故障：新增 ---------------- */
router.post('/manual-faults/create', async (req, res, next) => {
  try {
    const siteId = Number((req.body && req.body.site_id) || 0);
    if (!siteId) return res.status(400).json({ code: 400, message: '请选择站点' });
    const title = requiredStr(req.body && req.body.title, 200, '标题');
    const description = str(req.body && req.body.description, 5000, '描述');
    const progress = str(req.body && req.body.progress, 50, '进度') || '处理中';
    const status = bool(req.body && req.body.status) ? 1 : 0;
    await query(
      'INSERT INTO manual_faults (site_id, title, description, progress, status) VALUES (?,?,?,?,?)',
      [siteId, title, description, progress, status]
    );
    res.json({ code: 0, message: '故障事件已添加' });
  } catch (e) { next(e); }
});

/* ---------------- 手动故障：更新 ---------------- */
router.post('/manual-faults/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const siteId = Number((req.body && req.body.site_id) || 0);
    const title = requiredStr(req.body && req.body.title, 200, '标题');
    const description = str(req.body && req.body.description, 5000, '描述');
    const progress = str(req.body && req.body.progress, 50, '进度') || '处理中';
    const status = bool(req.body && req.body.status) ? 1 : 0;
    await query(
      'UPDATE manual_faults SET site_id=?, title=?, description=?, progress=?, status=? WHERE id=?',
      [siteId, title, description, progress, status, id]
    );
    res.json({ code: 0, message: '已更新' });
  } catch (e) { next(e); }
});

/* ---------------- 手动故障：删除 ---------------- */
router.post('/manual-faults/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM manual_faults WHERE id = ?', [Number(req.params.id)]);
    res.json({ code: 0, message: '已删除' });
  } catch (e) { next(e); }
});

/* ---------------- CSV 导出 ---------------- */
router.get('/export', async (req, res, next) => {
  try {
    const siteId = Number(req.query.site_id || 0);
    if (!siteId) return res.status(400).json({ code: 400, message: '请选择站点' });
    const site = await queryOne('SELECT id, name FROM sites WHERE id = ?', [siteId]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });
    const days = pickDays(req.query.days, 30);
    const since = sinceDate(days) + ' 00:00:00';

    const [availRows, faultRows] = await Promise.all([
      query(
        `SELECT DATE_FORMAT(checked_at, '%Y-%m-%d') AS d, SUM(status = 1) AS ok, COUNT(*) AS total
         FROM status_history WHERE site_id = ? AND checked_at >= ?
         GROUP BY DATE_FORMAT(checked_at, '%Y-%m-%d')`,
        [siteId, since]
      ),
      query(
        'SELECT title, description, progress, status, created_at FROM manual_faults WHERE site_id = ? AND created_at >= ? ORDER BY created_at DESC',
        [siteId, since]
      )
    ]);

    const lines = [];
    lines.push(['WebStatus 报表导出', site.name, '']);
    lines.push(['统计范围', '最近 ' + days + ' 天', '']);
    lines.push(['日期', '可用率(%)', '检测次数']);
    availRows.forEach(r => {
      const total = Number(r.total);
      const ok = Number(r.ok);
      lines.push([String(r.d), total ? Math.round((ok / total) * 10000) / 100 : '-', total]);
    });
    lines.push([]);
    lines.push(['最近故障事件']);
    lines.push(['时间', '标题', '进度', '状态', '描述']);
    faultRows.forEach(f => {
      lines.push([
        f.created_at,
        f.title,
        f.progress,
        Number(f.status) === 1 ? '已解决' : '处理中',
        String(f.description || '').replace(/[\r\n]+/g, ' ')
      ]);
    });

    const csv = lines.map(row => row.map(cell => {
      const s = String(cell === undefined || cell === null ? '' : cell);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="webstatus-report-' + siteId + '-' + days + 'd.csv"');
    res.send('﻿' + csv); // BOM 便于 Excel 识别 UTF-8
  } catch (e) { next(e); }
});

module.exports = router;
