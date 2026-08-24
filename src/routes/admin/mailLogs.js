'use strict';
/**
 * 邮件发送日志接口
 * 分页 + 筛选（类型 / 状态 / 邮箱关键字）。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(50, Math.max(1, Number(req.query.size) || 15));
    const mailType = String(req.query.mail_type || '').trim();
    const status = String(req.query.status || '').trim();
    const keyword = String(req.query.keyword || '').trim();

    const where = [];
    const params = [];
    if (mailType && mailType !== 'all') { where.push('mail_type = ?'); params.push(mailType); }
    if (status !== '' && status !== 'all') { where.push('status = ?'); params.push(status === '1' ? 1 : 0); }
    if (keyword) { where.push('to_email LIKE ?'); params.push('%' + keyword + '%'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = await queryOne('SELECT COUNT(*) AS c FROM mail_logs ' + whereSql, params);
    const limit = size;
    const offset = (page - 1) * size;
    const rows = await query(
      'SELECT id, to_email, mail_type, status, error_msg, created_at FROM mail_logs ' + whereSql + ' ORDER BY id DESC LIMIT ' + limit + ' OFFSET ' + offset,
      params
    );
    res.json({ code: 0, data: rows, total: Number(total.c), page, size });
  } catch (e) { next(e); }
});

module.exports = router;
