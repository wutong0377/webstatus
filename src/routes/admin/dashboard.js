'use strict';
/**
 * 仪表盘接口
 * 全部站点状态统计概览 + 最近故障预览 + 最近邮件发送记录预览 + 服务运行状态。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../../db');
const { getErrorExplain } = require('../../data/errorCodes');
const { getSitesLatest, getServiceStatus } = require('../../lib/monitor');

router.get('/overview', async (req, res, next) => {
  try {
    const sites = await getSitesLatest();
    const counts = { total: 0, up: 0, slow: 0, down: 0, maintenance: 0, unchecked: 0 };
    for (const s of sites) {
      counts.total += 1;
      if (s.status === 4) counts.maintenance += 1;
      else if (s.status === 1) counts.up += 1;
      else if (s.status === 2) counts.slow += 1;
      else if (s.status === 3) counts.down += 1;
      else counts.unchecked += 1;
    }

    const recentFaults = await query(
      'SELECT f.id, f.site_id, f.fault_status, f.http_code, f.error_code, f.error_msg, f.started_at, f.ended_at, f.duration_sec, s.name AS site_name FROM fault_logs f JOIN sites s ON f.site_id = s.id ORDER BY f.id DESC LIMIT 8'
    );
    // 附上错误解读（原因/建议），后台"最近故障"直接展示
    for (const f of recentFaults) {
      const ex = getErrorExplain(f.error_code, f.error_msg);
      f.explain = { name: ex.name, cause: ex.cause, level: ex.level };
    }
    const recentMails = await query('SELECT id, to_email, mail_type, status, error_msg, created_at FROM mail_logs ORDER BY id DESC LIMIT 8');
    const service = getServiceStatus();

    res.json({ code: 0, data: { counts, recentFaults, recentMails, service } });
  } catch (e) { next(e); }
});

module.exports = router;
