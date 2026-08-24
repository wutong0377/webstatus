'use strict';
/**
 * 公告管理接口
 * 发布 / 编辑 / 删除 / 置顶；内容经 HTML 白名单过滤（XSS 防护）。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../db');
const cache = require('../../lib/cache');
const { requiredStr, str, int, bool } = require('../../utils/validate');
const { sanitizeHtml } = require('../../utils/html');

function invalidate() { cache.del('pub_notices'); }

/* ---------------- 列表 ---------------- */
router.get('/', async (req, res, next) => {
  try {
    const rows = await query('SELECT id, title, content, is_pinned, sort, created_at, updated_at FROM notices ORDER BY is_pinned DESC, sort ASC, id DESC');
    res.json({ code: 0, data: rows });
  } catch (e) { next(e); }
});

/* ---------------- 发布 ---------------- */
router.post('/create', async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = requiredStr(body.title, 200, '公告标题');
    const content = sanitizeHtml(str(body.content, 10000, '公告内容'));
    const isPinned = bool(body.is_pinned);
    const sort = int(body.sort, { min: 0, max: 9999, name: '排序' });
    await query('INSERT INTO notices (title, content, is_pinned, sort) VALUES (?,?,?,?)', [title, content, isPinned ? 1 : 0, sort]);
    invalidate();
    res.json({ code: 0, message: '公告发布成功' });
  } catch (e) { next(e); }
});

/* ---------------- 编辑 ---------------- */
router.post('/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const title = requiredStr(body.title, 200, '公告标题');
    const content = sanitizeHtml(str(body.content, 10000, '公告内容'));
    const isPinned = bool(body.is_pinned);
    const sort = int(body.sort, { min: 0, max: 9999, name: '排序' });
    await query('UPDATE notices SET title=?, content=?, is_pinned=?, sort=? WHERE id=?', [title, content, isPinned ? 1 : 0, sort, id]);
    invalidate();
    res.json({ code: 0, message: '公告已更新' });
  } catch (e) { next(e); }
});

/* ---------------- 删除 ---------------- */
router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM notices WHERE id = ?', [id]);
    invalidate();
    res.json({ code: 0, message: '公告已删除' });
  } catch (e) { next(e); }
});

module.exports = router;
