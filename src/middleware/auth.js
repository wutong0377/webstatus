'use strict';
/**
 * 后台管理员鉴权中间件
 * 校验 session 中的管理员登录态；未登录时 API 返回 401 JSON，页面请求重定向到登录页。
 */

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  // API 请求返回 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ code: 401, message: '未登录或登录已过期' });
  }
  // 页面请求重定向登录页
  return res.redirect('/admin/login');
}

/** 登录后已访问后台则跳过（用于登录页反跳） */
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  next();
}

module.exports = { requireAdmin, redirectIfLoggedIn };
