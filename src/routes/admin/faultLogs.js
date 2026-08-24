'use strict';
/**
 * 故障日志接口
 * 按站点 / 状态 / 错误码筛选，分页；返回故障详情与错误解读关联数据。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');
const { getErrorExplain } = require('../../data/errorCodes');

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(50, Math.max(1, Number(req.query.size) || 15));
    const siteId = String(req.query.site_id || '').trim();
    const status = String(req.query.status || '').trim();
    const code = String(req.query.code || '').trim();

    const where = [];
    const params = [];
    if (siteId) { where.push('f.site_id = ?'); params.push(Number(siteId)); }
    if (status && status !== 'all') { where.push('f.fault_status = ?'); params.push(Number(status)); }
    if (code) { where.push('f.error_code = ?'); params.push(code); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const total = await queryOne('SELECT COUNT(*) AS c FROM fault_logs f ' + whereSql, params);
    const limit = size;
    const offset = (page - 1) * size;
    const rows = await query(
      'SELECT f.*, s.name AS site_name FROM fault_logs f LEFT JOIN sites s ON f.site_id = s.id ' + whereSql + ' ORDER BY f.id DESC LIMIT ' + limit + ' OFFSET ' + offset,
      params
    );
    // 附加错误解读
    const data = rows.map(r => ({ ...r, explain: getErrorExplain(r.error_code, r.error_msg) }));
    res.json({ code: 0, data, total: Number(total.c), page, size });
  } catch (e) { next(e); }
});

module.exports = router;
