'use strict';
/**
 * 系统设置接口
 *   - 业务参数读取/保存
 *   - 服务运行状态 / 手动触发完整巡检
 *   - 清空监控历史 / 故障日志 / 邮件日志
 *   - 导出完整数据库 .sql 备份
 *   - 站点下拉选项（供筛选）
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../db');
const cache = require('../../lib/cache');
const settingsSvc = require('../../lib/settings');
const { runOnce, getServiceStatus } = require('../../lib/monitor');
const { exportBackup } = require('../../lib/backup');
const { int, bool } = require('../../utils/validate');

/* ---------------- 业务参数 ---------------- */
router.get('/params', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await settingsSvc.getAll() });
  } catch (e) { next(e); }
});

router.post('/params', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = {};
    for (const k of Object.keys(settingsSvc.DEFAULT_SETTINGS)) {
      if (body[k] === undefined) continue;
      data[k] = typeof settingsSvc.DEFAULT_SETTINGS[k] === 'boolean'
        ? bool(body[k])
        : int(body[k], { min: 1, max: 999999, name: k });
    }
    await settingsSvc.setMany(data);
    cache.delPrefix('pub_');
    res.json({ code: 0, message: '系统参数已保存' });
  } catch (e) { next(e); }
});

/* ---------------- 服务运行状态 ---------------- */
router.get('/service', async (req, res, next) => {
  try {
    res.json({ code: 0, data: getServiceStatus() });
  } catch (e) { next(e); }
});

/* ---------------- 手动触发完整巡检 ---------------- */
router.post('/run-check', async (req, res, next) => {
  try {
    const result = await runOnce();
    res.json({ code: 0, message: '巡检已执行完成', data: result });
  } catch (e) { next(e); }
});

/* ---------------- 清空数据 ---------------- */
router.post('/clear-history', async (req, res, next) => {
  try {
    await query('DELETE FROM status_history');
    cache.delPrefix('pub_');
    res.json({ code: 0, message: '监控历史已清空' });
  } catch (e) { next(e); }
});

router.post('/clear-faults', async (req, res, next) => {
  try {
    await query('DELETE FROM fault_logs');
    res.json({ code: 0, message: '故障日志已清空' });
  } catch (e) { next(e); }
});

router.post('/clear-mails', async (req, res, next) => {
  try {
    await query('DELETE FROM mail_logs');
    res.json({ code: 0, message: '邮件发送日志已清空' });
  } catch (e) { next(e); }
});

/* ---------------- 导出数据库备份 ---------------- */
router.get('/export-backup', async (req, res, next) => {
  try {
    const sql = await exportBackup();
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="webstatus-backup-' + Date.now() + '.sql"');
    res.send(sql);
  } catch (e) { next(e); }
});

/* ---------------- 站点下拉选项 ---------------- */
router.get('/site-options', async (req, res, next) => {
  try {
    const rows = await query('SELECT id, name, domain FROM sites ORDER BY sort ASC, id ASC');
    res.json({ code: 0, data: rows });
  } catch (e) { next(e); }
});

module.exports = router;
