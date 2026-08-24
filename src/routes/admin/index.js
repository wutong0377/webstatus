'use strict';
/**
 * 后台管理 API 聚合路由
 * 全部子路由统一应用：登录鉴权 + CSRF 校验 + 严格限流。
 */
const express = require('express');
const path = require('path');
const router = express.Router();
const { requireAdmin } = require('../../middleware/auth');
const { csrfProtection } = require('../../middleware/csrf');
const { rateLimit } = require('../../middleware/rateLimit');
const { ROOT } = require('../../config');

router.use(requireAdmin);
router.use(csrfProtection);
router.use(rateLimit({ windowMs: 60 * 1000, max: 300, message: '请求过于频繁，请稍后再试' }));

router.use('/dashboard', require('./dashboard'));
router.use('/sites', require('./sites'));
router.use('/notices', require('./notices'));
router.use('/mail', require('./mail'));
router.use('/mail-logs', require('./mailLogs'));
router.use('/fault-logs', require('./faultLogs'));
router.use('/settings', require('./settings'));
router.use('/alerts', require('./alerts'));

// v1.1 新增路由
router.use('/accounts', require('./accounts'));
router.use('/sessions', require('./sessions'));
router.use('/version', require('./version'));
router.use('/report', require('./report'));

// v1.1 新后台页面（accounts / sessions / report / alerts）
// 规范 URL 为 /admin/<page>，由 app.js 的 /admin/:page 白名单控制；
// 该白名单暂未包含这些新页面，此路由作为过渡访问入口（需登录），
// 正式发布时应把页面名加入 app.js 白名单，并将入口加入 common.js 侧边栏菜单。
const ADMIN_PAGES = ['accounts', 'sessions', 'report', 'alerts'];
router.get('/pages/:page', (req, res) => {
  if (!ADMIN_PAGES.includes(req.params.page)) return res.status(404).send('Not Found');
  res.sendFile(path.join(ROOT, 'src', 'views', 'admin', req.params.page + '.html'));
});

module.exports = router;
