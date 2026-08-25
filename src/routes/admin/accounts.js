'use strict';
/**
 * 账号管理接口（仅 super / admin 可访问，readonly 禁止）
 *   - 账号列表 / 新建 / 修改 / 删除
 *   - 当前登录用户的 2FA（TOTP）开通 / 关闭
 * 安全说明：
 *   - password_hash、2fa_secret 绝不出现在任何返回结果中；
 *   - 2FA 密钥明文只在 generate 时返回一次，且仅允许操作当前登录账号。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query, queryOne } = require('../../db');
const { requireRole } = require('../../middleware/auth');
const { str, requiredStr, password } = require('../../utils/validate');
const { generateSecret, verifyTOTP } = require('../../lib/totp');

const ROLES = ['super', 'admin', 'readonly'];

router.use(requireRole(['super', 'admin']));

/* ---------------- 账号列表 ---------------- */
router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, username, display_name, role, `2fa_enabled` AS twofa_enabled, created_at, last_login_at FROM admin ORDER BY id ASC'
    );
    res.json({
      code: 0,
      data: rows.map(r => ({
        id: r.id,
        username: r.username,
        display_name: r.display_name || '',
        role: r.role || 'admin',
        twofa_enabled: Number(r.twofa_enabled) === 1,
        created_at: r.created_at,
        last_login_at: r.last_login_at,
        current: Number(r.id) === Number(req.session.adminId)
      }))
    });
  } catch (e) { next(e); }
});

/* ---------------- 新建账号 ---------------- */
router.post('/create', async (req, res, next) => {
  try {
    const username = requiredStr(req.body && req.body.username, 50, '用户名');
    if (username.length < 3) return res.status(400).json({ code: 400, message: '用户名长度至少 3 位' });
    const pwd = password(req.body && req.body.password, '密码');
    const displayName = str(req.body && req.body.display_name, 50, '显示名称');
    const role = str(req.body && req.body.role, 20, '角色');
    if (!ROLES.includes(role)) return res.status(400).json({ code: 400, message: '角色不合法' });
    const hash = bcrypt.hashSync(pwd, 10);
    await query(
      'INSERT INTO admin (username, password_hash, display_name, role) VALUES (?,?,?,?)',
      [username, hash, displayName, role]
    );
    res.json({ code: 0, message: '账号已创建' });
  } catch (e) {
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
      return res.status(400).json({ code: 400, message: '用户名已存在' });
    }
    next(e);
  }
});

/* ---------------- 更新账号（角色/显示名/可选重置密码） ---------------- */
router.post('/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await queryOne('SELECT id, role FROM admin WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ code: 404, message: '账号不存在' });
    const displayName = str(req.body && req.body.display_name, 50, '显示名称');
    const role = str(req.body && req.body.role, 20, '角色');
    if (!ROLES.includes(role)) return res.status(400).json({ code: 400, message: '角色不合法' });
    // 安全护栏：不允许移除自己的 super 角色，避免把自己锁死
    if (id === req.session.adminId && cur.role === 'super' && role !== 'super') {
      return res.status(400).json({ code: 400, message: '不能移除自己的超级管理员角色' });
    }
    const newPwd = (req.body && req.body.password) ? String(req.body.password) : '';
    if (newPwd) {
      const pwd = password(newPwd, '新密码');
      const hash = bcrypt.hashSync(pwd, 10);
      await query('UPDATE admin SET display_name=?, role=?, password_hash=? WHERE id=?', [displayName, role, hash, id]);
    } else {
      await query('UPDATE admin SET display_name=?, role=? WHERE id=?', [displayName, role, id]);
    }
    res.json({ code: 0, message: '账号已更新' });
  } catch (e) { next(e); }
});

/* ---------------- 删除账号 ---------------- */
router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.session.adminId) {
      return res.status(400).json({ code: 400, message: '不能删除当前登录的账号' });
    }
    const cur = await queryOne('SELECT id, role FROM admin WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ code: 404, message: '账号不存在' });
    if (cur.role === 'super') {
      const cnt = await queryOne('SELECT COUNT(*) AS c FROM admin WHERE role = ?', ['super']);
      if (Number(cnt.c) <= 1) {
        return res.status(400).json({ code: 400, message: '至少保留一个超级管理员账号' });
      }
    }
    await query('DELETE FROM admin WHERE id = ?', [id]);
    res.json({ code: 0, message: '账号已删除' });
  } catch (e) { next(e); }
});

/* ---------------- 2FA：生成密钥（仅当前登录账号） ---------------- */
router.post('/:id(\\d+)/2fa/generate', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id !== req.session.adminId) {
      return res.status(403).json({ code: 403, message: '只能为当前登录账号配置两步验证' });
    }
    const admin = await queryOne('SELECT username FROM admin WHERE id = ?', [id]);
    if (!admin) return res.status(404).json({ code: 404, message: '账号不存在' });
    const secret = generateSecret();
    const otpauth = 'otpauth://totp/WebStatus:' + encodeURIComponent(admin.username) + '?secret=' + secret + '&issuer=WebStatus';
    // 明文 secret 只返回这一次，用于认证器手动录入；不写入数据库
    res.json({ code: 0, secret, otpauth });
  } catch (e) { next(e); }
});

/* ---------------- 2FA：校验并启用（仅当前登录账号） ---------------- */
router.post('/:id(\\d+)/2fa/verify', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id !== req.session.adminId) {
      return res.status(403).json({ code: 403, message: '只能为当前登录账号配置两步验证' });
    }
    const secret = str(req.body && req.body.secret, 64, '密钥');
    const code = String((req.body && req.body.code) || '').trim();
    if (!secret || !code) return res.status(400).json({ code: 400, message: '缺少密钥或动态口令' });
    if (!verifyTOTP(secret, code, 1)) {
      return res.status(400).json({ code: 400, message: '动态口令不正确，请核对后重试' });
    }
    await query('UPDATE admin SET `2fa_enabled` = 1, `2fa_secret` = ? WHERE id = ?', [secret, id]);
    res.json({ code: 0, message: '两步验证已启用' });
  } catch (e) { next(e); }
});

/* ---------------- 2FA：关闭（仅当前登录账号） ---------------- */
router.post('/:id(\\d+)/2fa/disable', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id !== req.session.adminId) {
      return res.status(403).json({ code: 403, message: '只能为当前登录账号配置两步验证' });
    }
    await query('UPDATE admin SET `2fa_enabled` = 0, `2fa_secret` = ? WHERE id = ?', ['', id]);
    res.json({ code: 0, message: '两步验证已关闭' });
  } catch (e) { next(e); }
});

module.exports = router;
