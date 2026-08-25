'use strict';
/**
 * 登录认证路由
 *   - 密码 bcrypt 比对；
 *   - 登录失败计数临时锁定账号（5 次失败锁 15 分钟）；
 *   - 登录接口独立限流；
 *   - POST 接口带 CSRF 校验。
 *
 * v1.1 扩展：
 *   - TOTP 双因素认证：账号启用 2FA 时登录成功后不直接放行，
 *     返回一次性临时票据（5 分钟有效），由 /verify-2fa 校验动态口令后建立会话；
 *   - 建立会话时把登录会话写入 auth_sessions，供后台会话管理 / 强制下线使用；
 *   - 登录时写入角色（role）到 session，供 RBAC 中间件使用。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const { query, queryOne } = require('../db');
const { csrfProtection, ensureToken } = require('../middleware/csrf');
const { rateLimit, resetLimit } = require('../middleware/rateLimit');
const { verifyTOTP } = require('../lib/totp');

// 登录失败锁定（内存态）
const loginFailures = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

// 2FA 待校验临时票据（内存态，5 分钟过期）
const twoFactorTickets = new Map();
const TICKET_TTL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of twoFactorTickets) {
    if (now - v.createdAt > TICKET_TTL) twoFactorTickets.delete(k);
  }
}, 60 * 1000).unref();

/**
 * 获取真实客户端 IP：反代后优先取 X-Forwarded-For 第一段，剥离 IPv6-mapped 前缀。
 * 仅用于会话展示 / 最后登录 IP 记录，不参与登录锁定（锁定仍用 req.ip 防伪造绕过）。
 */
function getClientIp(req) {
  let ip = '';
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) ip = first;
  }
  if (!ip && req.ip) ip = req.ip;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip.slice(0, 45);
}

function lockKey(username, ip) { return String(username || '').toLowerCase() + '|' + ip; }

function isLocked(username, ip) {
  const f = loginFailures.get(lockKey(username, ip));
  if (f && f.until && Date.now() < f.until) {
    return { locked: true, remaining: Math.ceil((f.until - Date.now()) / 1000) };
  }
  return { locked: false };
}

function recordFailure(username, ip) {
  const key = lockKey(username, ip);
  const f = loginFailures.get(key) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  loginFailures.set(key, f);
}

/** 建立完整登录会话：regenerate + 写入身份 + 记录 auth_sessions + 更新最后登录 */
async function establishSession(req, res, admin) {
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  req.session.role = admin.role || 'admin';
  ensureToken(req, res);
  const ua = String(req.headers['user-agent'] || '').slice(0, 255);
  const ip = getClientIp(req);
  await query(
    'INSERT INTO auth_sessions (admin_id, session_id, user_agent, ip) VALUES (?,?,?,?)',
    [admin.id, req.sessionID, ua, ip]
  );
  await query('UPDATE admin SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [ip, admin.id]);
}

/* ---------------- 登录状态 ---------------- */
router.get('/status', (req, res) => {
  ensureToken(req, res); // 生成并返回 CSRF token
  res.json({
    loggedIn: !!(req.session && req.session.adminId),
    username: req.session.username || '',
    role: req.session.role || '',
    csrfToken: req.session.csrfToken
  });
});

/* ---------------- 登录 ---------------- */
router.post('/login',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 30, message: '登录尝试过于频繁，请 5 分钟后再试' }),
  csrfProtection,
  async (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const ip = req.ip || 'unknown';

    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '请输入用户名和密码' });
    }
    const lock = isLocked(username, ip);
    if (lock.locked) {
      return res.status(429).json({ code: 429, message: '登录失败次数过多，账号已临时锁定，请 ' + lock.remaining + ' 秒后再试' });
    }

    try {
      const admins = await query('SELECT id, username, password_hash, role, `2fa_enabled`, `2fa_secret` FROM admin WHERE username = ?', [username]);
      if (!admins.length) {
        recordFailure(username, ip);
        return res.status(401).json({ code: 401, message: '用户名或密码错误' });
      }
      const ok = await bcrypt.compare(password, admins[0].password_hash);
      if (!ok) {
        recordFailure(username, ip);
        return res.status(401).json({ code: 401, message: '用户名或密码错误' });
      }
      // 密码正确：清空失败计数（即使还需 2FA，密码这一步已通过）
      resetLimit(ip);
      loginFailures.delete(lockKey(username, ip));

      const admin = admins[0];
      if (Number(admin['2fa_enabled']) === 1) {
        // 账号已启用 2FA：不建立会话，发放一次性临时票据
        const token = crypto.randomBytes(24).toString('hex');
        twoFactorTickets.set(token, { adminId: admin.id, username: admin.username, role: admin.role, createdAt: Date.now() });
        return res.json({ code: 0, need2fa: true, tempToken: token, message: '请输入动态口令' });
      }

      // 无 2FA：直接建立完整会话
      await establishSession(req, res, admin);
      res.json({ code: 0, message: '登录成功', csrfToken: req.session.csrfToken });
    } catch (e) {
      res.status(500).json({ code: 500, message: '登录失败，请稍后再试' });
    }
  });

/* ---------------- 2FA 动态口令校验（登录第二步） ---------------- */
router.post('/verify-2fa',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 30, message: '尝试过于频繁，请稍后再试' }),
  csrfProtection,
  async (req, res) => {
    const tempToken = String((req.body && req.body.tempToken) || '').trim();
    const code = String((req.body && req.body.code) || '').trim();
    if (!tempToken || !code) {
      return res.status(400).json({ code: 400, message: '缺少验证参数' });
    }
    const ticket = twoFactorTickets.get(tempToken);
    if (!ticket || Date.now() - ticket.createdAt > TICKET_TTL) {
      twoFactorTickets.delete(tempToken);
      return res.status(400).json({ code: 400, message: '验证已过期，请重新登录' });
    }
    try {
      const admin = await queryOne('SELECT id, username, role, `2fa_enabled`, `2fa_secret` FROM admin WHERE id = ?', [ticket.adminId]);
      if (!admin || Number(admin['2fa_enabled']) !== 1) {
        twoFactorTickets.delete(tempToken);
        return res.status(400).json({ code: 400, message: '账号状态异常，请重新登录' });
      }
      if (!verifyTOTP(admin['2fa_secret'], code, 1)) {
        return res.status(400).json({ code: 400, message: '动态口令错误，请重试' });
      }
      twoFactorTickets.delete(tempToken);
      await establishSession(req, res, admin);
      res.json({ code: 0, message: '登录成功', csrfToken: req.session.csrfToken });
    } catch (e) {
      res.status(500).json({ code: 500, message: '登录失败，请稍后再试' });
    }
  });

/* ---------------- 登出 ---------------- */
router.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy(() => res.json({ code: 0, message: '已退出登录' }));
});

module.exports = router;
