'use strict';
/**
 * 登录认证路由
 *   - 密码 bcrypt 比对；
 *   - 登录失败计数临时锁定账号（5 次失败锁 15 分钟）；
 *   - 登录接口独立限流；
 *   - POST 接口带 CSRF 校验。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { query } = require('../db');
const { csrfProtection, ensureToken } = require('../middleware/csrf');
const { rateLimit, resetLimit } = require('../middleware/rateLimit');

// 登录失败锁定（内存态）
const loginFailures = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

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

/* ---------------- 登录状态 ---------------- */
router.get('/status', (req, res) => {
  ensureToken(req, res); // 生成并返回 CSRF token
  res.json({
    loggedIn: !!(req.session && req.session.adminId),
    username: req.session.username || '',
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
      const admins = await query('SELECT id, username, password_hash FROM admin WHERE username = ?', [username]);
      if (!admins.length) {
        recordFailure(username, ip);
        return res.status(401).json({ code: 401, message: '用户名或密码错误' });
      }
      const ok = await bcrypt.compare(password, admins[0].password_hash);
      if (!ok) {
        recordFailure(username, ip);
        return res.status(401).json({ code: 401, message: '用户名或密码错误' });
      }
      // 登录成功：重新生成会话 ID（防会话固定攻击），再写入管理员身份并更新 CSRF token
      await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
      req.session.adminId = admins[0].id;
      req.session.username = admins[0].username;
      ensureToken(req, res);
      resetLimit(ip);
      loginFailures.delete(lockKey(username, ip));
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
