'use strict';
/**
 * 后台管理员鉴权中间件
 * 校验 session 中的管理员登录态；未登录时 API 返回 401 JSON，页面请求重定向到登录页。
 *
 * v1.1 扩展：
 *   - RBAC：登录时把角色写入 req.session.role；
 *     readonly 只读账号禁止任何写操作（非 GET/HEAD/OPTIONS → 403）；
 *   - 会话强制下线：auth_sessions 中被置 revoked=1 的会话，下次请求即销毁并返回 401；
 *   - requireRole(roles)：限定某路由仅允许指定角色访问。
 */
const { query } = require('../db');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ code: 401, message: '未登录或登录已过期' });
    return res.redirect('/admin/login');
  }

  // 会话可能已被管理员强制下线：销毁会话并按 401 处理
  try {
    const rows = await query('SELECT revoked FROM auth_sessions WHERE session_id = ? LIMIT 1', [req.sessionID]);
    if (rows.length && Number(rows[0].revoked) === 1) {
      req.session.destroy(() => {});
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ code: 401, message: '会话已被管理员强制下线，请重新登录' });
      }
      return res.redirect('/admin/login');
    }
  } catch (e) {
    // 查询失败（如迁移未完成 / 表不存在）不阻断登录态校验
  }

  // 只读账号仅允许只读方法
  if (req.session.role === 'readonly' && READ_METHODS.indexOf(req.method) === -1) {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ code: 403, message: '只读账号无此权限' });
    }
    return res.status(403).send('只读账号无此权限');
  }

  next();
}

/**
 * 角色限定中间件：仅允许指定角色访问
 * @param {string|string[]} roles 允许的角色（super/admin/readonly）
 */
function requireRole(roles) {
  const allow = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.session || !req.session.adminId) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ code: 401, message: '未登录或登录已过期' });
      return res.redirect('/admin/login');
    }
    if (!allow.includes(req.session.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ code: 403, message: '无权限执行此操作' });
      return res.status(403).send('无权限执行此操作');
    }
    next();
  };
}

/** 登录后已访问后台则跳过（用于登录页反跳） */
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  next();
}

module.exports = { requireAdmin, requireRole, redirectIfLoggedIn };
