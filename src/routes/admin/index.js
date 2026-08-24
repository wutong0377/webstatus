'use strict';
/**
 * 后台管理 API 聚合路由
 * 全部子路由统一应用：登录鉴权 + CSRF 校验 + 严格限流。
 */
const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/auth');
const { csrfProtection } = require('../../middleware/csrf');
const { rateLimit } = require('../../middleware/rateLimit');

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

module.exports = router;
