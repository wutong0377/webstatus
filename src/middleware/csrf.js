'use strict';
/**
 * 自研 CSRF 防护中间件（替代已废弃的 csurf 库）
 * 原理：session 中保存随机 token，前端在请求头 X-CSRF-Token 或表单 _csrf 中回传。
 * 所有非 GET/HEAD/OPTIONS 请求必须携带有效 token。
 */
const crypto = require('crypto');

/** 确保 session 中存在 CSRF token，并挂到 res.locals 供页面渲染 */
function ensureToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
}

/** 校验 CSRF token（需要先挂 ensureToken 的会话） */
function csrfProtection(req, res, next) {
  // 先确保 token 已生成（GET 也要生成以便页面读取）
  ensureToken(req, res);

  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // 从 header 或 body 读取 token
  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  const sessionToken = req.session.csrfToken;

  if (!sessionToken || !token || typeof token !== 'string' || token !== sessionToken) {
    res.status(403).json({ code: 403, message: 'CSRF 校验失败，请刷新页面后重试' });
    return;
  }
  next();
}

module.exports = { csrfProtection, ensureToken };
