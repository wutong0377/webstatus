'use strict';
/**
 * 公开接口（无需登录）
 * 只读已入库结果，绝不触发探测/ping；带内存缓存与 IP 限流。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const cache = require('../lib/cache');
const settingsSvc = require('../lib/settings');
const { getSitesLatest, attachSecurityStatus, runOnce } = require('../lib/monitor');
const { config } = require('../config');
const { downsample } = require('../lib/downsample');
const { STATUS_TEXT } = require('../lib/status');
const { getErrorExplain } = require('../data/errorCodes');
const { rateLimit } = require('../middleware/rateLimit');

// 公开接口 IP 限流
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, message: '请求过于频繁，请稍后再试' }));

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 时间范围边界 */
function rangeBound(range) {
  const now = new Date();
  const DAY = 86400 * 1000;
  let fromMs = now.getTime() - 24 * 3600 * 1000;
  if (range === 'hour') fromMs = now.getTime() - 3600 * 1000;
  if (range === 'week') fromMs = now.getTime() - 7 * DAY;
  if (range === 'month') fromMs = now.getTime() - 30 * DAY;
  return { from: fmt(new Date(fromMs)), to: fmt(now) };
}

/** 状态变更点（相邻状态不同的记录） */
async function getStatusChanges(siteId, from, to) {
  const rows = await query(
    'SELECT checked_at, status, delay, error_code, error_msg FROM status_history WHERE site_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC, id ASC',
    [siteId, from, to]
  );
  const changes = [];
  let prev = null;
  for (const r of rows) {
    if (r.status !== prev) {
      changes.push(r);
      prev = r.status;
    }
  }
  return changes;
}

/* ---------------- 全部站点最新状态 ---------------- */
router.get('/status', async (req, res, next) => {
  try {
    const settings = await settingsSvc.getAll();
    const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
    let data = cache.get('pub_status');
    if (!data) {
      data = await attachSecurityStatus(await getSitesLatest());
      cache.set('pub_status', data, ttl);
    }
    // CDN / 浏览器缓存头（配合 CF 边缘缓存）
    res.setHeader('Cache-Control', 'public, max-age=' + ttl);
    // 当前生效的维护窗口（前台展示）
    const windows = await query(
      'SELECT mw.id, mw.site_id, mw.title, mw.start_at, mw.end_at, s.name AS site_name FROM maintenance_windows mw LEFT JOIN sites s ON mw.site_id = s.id WHERE mw.enabled = 1 AND mw.start_at <= NOW() AND mw.end_at >= NOW() ORDER BY mw.end_at ASC LIMIT 20'
    ).catch(() => []);
    res.json({ code: 0, data, refresh: Number(settings.frontend_refresh) || 30, windows });
  } catch (e) { next(e); }
});

/* ---------------- 站点详情（曲线 + 时间线 + 故障记录） ---------------- */
router.get('/site/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const site = await queryOne('SELECT * FROM sites WHERE id = ?', [id]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });

    // 附带最新一次探测结果（last_*），供详情页顶部指标展示
    const last = await queryOne(
      'SELECT status, delay, http_code, error_code, error_msg, checked_at, dns_ms, tcp_ms, tls_ms, ttfb_ms FROM status_history WHERE site_id = ? ORDER BY id DESC LIMIT 1',
      [id]
    );
    if (last) {
      site.last_status = last.status;
      site.last_delay = last.delay;
      site.last_http_code = last.http_code;
      site.last_error_code = last.error_code;
      site.last_error_msg = last.error_msg;
      site.last_checked_at = last.checked_at;
      site.last_dns_ms = last.dns_ms;
      site.last_tcp_ms = last.tcp_ms;
      site.last_tls_ms = last.tls_ms;
      site.last_ttfb_ms = last.ttfb_ms;
    } else {
      site.last_status = null;
      site.last_delay = null;
      site.last_http_code = null;
      site.last_error_code = null;
      site.last_error_msg = null;
      site.last_checked_at = null;
      site.last_dns_ms = null;
      site.last_tcp_ms = null;
      site.last_tls_ms = null;
      site.last_ttfb_ms = null;
    }
    // 统一 status：维修模式强制 4，否则取最新探测状态
    site.status = site.maintenance === 1 ? 4 : (site.last_status || null);

    // 最新 SSL 证书 / 域名到期检测结果（v2 展示）
    const [cert, domain] = await Promise.all([
      queryOne('SELECT status, issuer, subject, san, valid_from, valid_to, days_left, error_code, checked_at, ocsp_status FROM cert_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', [id]).catch(() => null),
      queryOne('SELECT status, domain, expiry_date, days_left, registrar, error_code, checked_at FROM domain_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', [id]).catch(() => null)
    ]);

    const range = ['hour', 'day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'day';
    const settings = await settingsSvc.getAll();
    const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
    const cacheKey = 'pub_site_' + id + '_' + range;
    let data = cache.get(cacheKey);
    if (!data) {
      const { from, to } = rangeBound(range);
      const [historyRows, changeRows, faultRows] = await Promise.all([
        query('SELECT checked_at, status, delay, http_code, error_code FROM status_history WHERE site_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC', [id, from, to]),
        getStatusChanges(id, from, to),
        query('SELECT id, fault_status, http_code, error_code, error_msg, started_at, ended_at, duration_sec FROM fault_logs WHERE site_id = ? ORDER BY started_at DESC LIMIT 50', [id])
      ]);
      data = {
        site,
        chart: downsample(historyRows, 200),
        changes: changeRows,
        faults: faultRows.map(f => {
          const ex = getErrorExplain(f.error_code, f.error_msg);
          return {
            ...f,
            status_text: STATUS_TEXT[f.fault_status] || '异常',
            explain: { name: ex.name, cause: ex.cause, causes: ex.causes, tips: ex.tips, level: ex.level }
          };
        }),
        cert,
        domain
      };
      cache.set(cacheKey, data, ttl);
    }
    res.setHeader('Cache-Control', 'public, max-age=' + ttl);
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 迷你时间线（卡片内状态预览，批量） ---------------- */
router.get('/mini-timeline', async (req, res, next) => {
  try {
    const ids = String(req.query.id || '').split(',').map(s => Number(s.trim())).filter(n => n > 0).slice(0, 10);
    if (!ids.length) return res.json({ code: 0, data: {} });
    const cacheKey = 'pub_mini_' + ids.join('_');
    let data = cache.get(cacheKey);
    if (!data) {
      const settings = await settingsSvc.getAll();
      const ttl = Math.max(1, Number(settings.cache_ttl) || 5) * 1000;
      data = {};
      for (const sid of ids) {
        // 96 个历史点，供前台卡片渲染状态方块条
        const rows = await query('SELECT status, checked_at FROM status_history WHERE site_id = ? ORDER BY id DESC LIMIT 96', [sid]);
        data[sid] = rows.reverse();
      }
      cache.set(cacheKey, data, ttl);
    }
    res.setHeader('Cache-Control', 'public, max-age=' + ttl);
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 近 7 天可用率（全部站点，供前台展示） ---------------- */
router.get('/availability', async (req, res, next) => {
  try {
    const { from } = rangeBound('week');
    const rows = await query(
      'SELECT site_id, SUM(status = 1) AS ok, COUNT(*) AS total FROM status_history WHERE checked_at >= ? GROUP BY site_id',
      [from]
    );
    const map = {};
    for (const r of rows) {
      map[r.site_id] = Number(r.total) ? Math.round((Number(r.ok) / Number(r.total)) * 10000) / 100 : null;
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ code: 0, data: map });
  } catch (e) { next(e); }
});

/* ---------------- 公告列表 ---------------- */
router.get('/notices', async (req, res, next) => {
  try {
    let data = cache.get('pub_notices');
    if (!data) {
      data = await query('SELECT id, title, content, is_pinned FROM notices ORDER BY is_pinned DESC, sort ASC, id DESC LIMIT 20');
      cache.set('pub_notices', data, 10000);
    }
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.json({ code: 0, data });
  } catch (e) { next(e); }
});

/* ---------------- 站点历史 CSV 导出 ---------------- */
router.get('/site/:id/export', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const site = await queryOne('SELECT id, name FROM sites WHERE id = ?', [id]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });
    const rows = await query(
      'SELECT checked_at, status, delay, http_code, error_code, error_msg FROM status_history WHERE site_id = ? ORDER BY checked_at ASC, id ASC',
      [id]
    );
    const header = ['时间', '状态', '延迟(ms)', 'HTTP状态码', '错误码', '错误信息'];
    const lines = rows.map(r => [
      r.checked_at,
      STATUS_TEXT[r.status] || r.status,
      r.delay,
      r.http_code || '',
      r.error_code || '',
      '"' + String(r.error_msg || '').replace(/"/g, '""') + '"'
    ].join(','));
    // BOM 便于 Excel 识别 UTF-8
    const csv = '﻿' + header.join(',') + '\n' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="webstatus-site-' + id + '-history.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

/* ---------------- 极验(GeeTest)人机验证 + 手动触发检测（v2.4） ---------------- */
const runCheckCalls = new Map(); // ip -> 上次触发时间

/** 极验 v3 服务端校验 */
async function geetestValidate(gt, challenge, validate, seccode) {
  try {
    const params = new URLSearchParams({
      gt: String(gt || ''), challenge: String(challenge || ''),
      validate: String(validate || ''), seccode: String(seccode || ''), json: '1'
    });
    const res = await fetch('https://api.geetest.com/validate.php?' + params.toString(), { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) {}
    return { ok: data.seccode === String(seccode || ''), raw: text };
  } catch (e) { return { ok: false, raw: (e && e.message) || '校验异常' }; }
}

/** 极验 v3 注册获取 challenge */
async function geetestRegister(captchaId) {
  const res = await fetch('https://api.geetest.com/register.php?gt=' + encodeURIComponent(captchaId) + '&json=1', { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  return data.challenge || '';
}

/** 获取极验初始化参数（前台加载验证码用） */
router.get('/captcha/init', async (req, res, next) => {
  try {
    const g = config.geetest || {};
    if (!g.enabled || !g.captcha_id) return res.json({ code: 0, enabled: false });
    const challenge = await geetestRegister(g.captcha_id);
    res.json({ code: 0, enabled: true, gt: g.captcha_id, challenge, new_captcha: true });
  } catch (e) { next(e); }
});

/**
 * 前台「获取最新情况」：手动触发一轮完整巡检
 * 限频：每 IP 60 秒内最多 1 次；若极验已启用，60 秒内的再次触发需通过人机验证。
 */
router.post('/run-check',
  rateLimit({ windowMs: 60 * 1000, max: 10, message: '触发过于频繁，请稍后再试' }),
  async (req, res, next) => {
    try {
      const g = config.geetest || {};
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const last = runCheckCalls.get(ip) || 0;
      const needsCaptcha = g.enabled && g.captcha_id && (now - last) < 60 * 1000;

      if (needsCaptcha) {
        const { gt, challenge, validate, seccode } = (req.body && typeof req.body === 'object') ? req.body : {};
        if (!challenge || !validate || !seccode) {
          return res.status(403).json({ code: 403, needCaptcha: true, message: '请先完成人机验证' });
        }
        const v = await geetestValidate(gt, challenge, validate, seccode);
        if (!v.ok) return res.status(403).json({ code: 403, needCaptcha: true, message: '人机验证失败，请重试' });
      }
      runCheckCalls.set(ip, now);
      // 清理过期记录，防止内存膨胀
      if (runCheckCalls.size > 5000) {
        for (const [k, t] of runCheckCalls) if (now - t > 3600000) runCheckCalls.delete(k);
      }
      const result = await runOnce();
      res.json({ code: 0, message: '已触发一轮检测', data: result });
    } catch (e) { next(e); }
  });

module.exports = router;
