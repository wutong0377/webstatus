'use strict';
/**
 * 会话管理接口
 *   - 列出全部登录会话（JOIN admin 显示用户名，并标记当前会话）
 *   - 强制下线：把 auth_sessions.revoked 置 1，被下线会话下次请求自动销毁
 * 安全说明：仅返回登录会话相关字段，绝不包含任何账号敏感字段（含 2fa_secret）。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');

/* ---------------- 会话列表 ---------------- */
router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT s.id, s.admin_id, s.session_id, s.user_agent, s.ip, s.created_at, s.last_active_at, s.revoked, a.username, a.display_name ' +
      'FROM auth_sessions s LEFT JOIN admin a ON s.admin_id = a.id ORDER BY s.id DESC'
    );
    const current = req.sessionID;
    res.json({
      code: 0,
      data: rows.map(r => ({
        id: r.id,
        admin_id: r.admin_id,
        username: r.username || ('#' + r.admin_id),
        display_name: r.display_name || '',
        user_agent: r.user_agent || '',
        ip: r.ip || '',
        created_at: r.created_at,
        last_active_at: r.last_active_at,
        revoked: Number(r.revoked) === 1,
        current: r.session_id === current
      }))
    });
  } catch (e) { next(e); }
});

/* ---------------- 强制下线 ---------------- */
router.post('/:id(\\d+)/revoke', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await queryOne('SELECT session_id FROM auth_sessions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ code: 404, message: '会话不存在' });
    if (row.session_id === req.sessionID) {
      return res.status(400).json({ code: 400, message: '不能下线当前会话' });
    }
    await query('UPDATE auth_sessions SET revoked = 1 WHERE id = ?', [id]);
    res.json({ code: 0, message: '会话已强制下线' });
  } catch (e) { next(e); }
});

module.exports = router;
