'use strict';
/**
 * 站点管理接口
 * 增删改查（后端强制上限 10 个）；编辑含名称/简介/SEO/图标URL/维修模式；
 * 域名需通过 SSRF 校验（探测时二次校验）。
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db');
const cache = require('../../lib/cache');
const { getSitesLatest, attachSecurityStatus, removeSiteMemory } = require('../../lib/monitor');
const { requiredStr, str, url, int, bool } = require('../../utils/validate');
const { validateMonitorDomain } = require('../../utils/net');

const MAX_SITES = 10;

/** 解析站点配置字段（v1.1 含探测/告警/证书/域名/OCSP 开关） */
function parseSiteFields(body) {
  return {
    name: requiredStr(body.name, 100, '站点名称'),
    domain: validateMonitorDomain(body.domain),
    description: str(body.description, 500, '站点简介'),
    seoTitle: str(body.seo_title, 200, 'SEO 标题'),
    seoDesc: str(body.seo_desc, 500, 'SEO 描述'),
    seoKeywords: str(body.seo_keywords, 500, 'SEO 关键词'),
    iconUrl: body.icon_url ? url(body.icon_url, '站点图标') : '',
    enabled: bool(body.enabled),
    maintenance: bool(body.maintenance),
    maintenanceNote: str(body.maintenance_note, 500, '维修备注'),
    sort: int(body.sort, { min: 0, max: 9999, name: '排序' }),
    alertEnabled: bool(body.alert_enabled),
    expectedStatus: body.expected_status ? int(body.expected_status, { min: 100, max: 599, name: '期望状态码' }) : null,
    checkDns: bool(body.check_dns),
    checkCert: bool(body.check_cert),
    certWarnDays: int(body.cert_warn_days, { min: 1, max: 365, def: 30, name: '证书预警天数' }),
    checkTcp: bool(body.check_tcp),
    tcpPort: body.tcp_port ? int(body.tcp_port, { min: 1, max: 65535, name: 'TCP端口' }) : null,
    monitorMode: ['http', 'tcp', 'icmp'].includes(body.monitor_mode) ? body.monitor_mode : 'http',
    checkDomain: bool(body.check_domain),
    domainWarnDays: int(body.domain_warn_days, { min: 7, max: 365, def: 90, name: '域名预警天数' }),
    checkOcsp: bool(body.check_ocsp),
    checkHeaders: bool(body.check_headers)
  };
}

/** 站点表列白名单（固定字符串，无注入风险） */
const SITE_COLS = [
  'name', 'domain', 'description', 'seo_title', 'seo_desc', 'seo_keywords',
  'icon_url', 'enabled', 'maintenance', 'maintenance_note', 'sort',
  'alert_enabled', 'expected_status', 'check_dns', 'check_cert', 'cert_warn_days',
  'check_tcp', 'tcp_port', 'monitor_mode', 'check_domain', 'domain_warn_days', 'check_ocsp', 'check_headers'
];
/** 与 SITE_COLS 顺序一致的值数组 */
function siteValues(f) {
  return [
    f.name, f.domain, f.description, f.seoTitle, f.seoDesc, f.seoKeywords,
    f.iconUrl, f.enabled ? 1 : 0, f.maintenance ? 1 : 0, f.maintenanceNote, f.sort,
    f.alertEnabled ? 1 : 0, f.expectedStatus, f.checkDns ? 1 : 0, f.checkCert ? 1 : 0, f.certWarnDays,
    f.checkTcp ? 1 : 0, f.tcpPort, f.monitorMode, f.checkDomain ? 1 : 0, f.domainWarnDays, f.checkOcsp ? 1 : 0, f.checkHeaders ? 1 : 0
  ];
}

/** 站点/公告变更后失效公开缓存 */
function invalidateCache() {
  cache.delPrefix('pub_status');
  cache.delPrefix('pub_site_');
  cache.delPrefix('pub_notices');
}

/* ---------------- 站点列表（含最新状态） ---------------- */
router.get('/', async (req, res, next) => {
  try {
    const data = await attachSecurityStatus(await getSitesLatest());
    res.json({ code: 0, data, maxSites: MAX_SITES });
  } catch (e) { next(e); }
});

/* ---------------- 单个站点（含统计） ---------------- */
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const site = await queryOne('SELECT * FROM sites WHERE id = ?', [id]);
    if (!site) return res.status(404).json({ code: 404, message: '站点不存在' });
    const stats = await query('SELECT status, COUNT(*) AS cnt FROM status_history WHERE site_id = ? GROUP BY status', [id]);
    const last = await queryOne('SELECT * FROM status_history WHERE site_id = ? ORDER BY id DESC LIMIT 1', [id]);
    const faultCount = await queryOne('SELECT COUNT(*) AS c FROM fault_logs WHERE site_id = ?', [id]);
    res.json({ code: 0, data: { site, stats, last, faultCount: Number(faultCount.c) } });
  } catch (e) { next(e); }
});

/* ---------------- 站点证书/域名检测结果（v2） ---------------- */
router.get('/:id(\\d+)/checks', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [cert, domain] = await Promise.all([
      queryOne('SELECT * FROM cert_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', [id]).catch(() => null),
      queryOne('SELECT * FROM domain_checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', [id]).catch(() => null)
    ]);
    res.json({ code: 0, data: { cert, domain } });
  } catch (e) { next(e); }
});

/* ---------------- 新增站点 ---------------- */
router.post('/create', async (req, res, next) => {
  try {
    const f = parseSiteFields(req.body || {});

    const cnt = await queryOne('SELECT COUNT(*) AS c FROM sites');
    if (Number(cnt.c) >= MAX_SITES) {
      return res.status(400).json({ code: 400, message: '站点数量已达上限（最多 ' + MAX_SITES + ' 个），请删除后再添加' });
    }

    await query(
      'INSERT INTO sites (' + SITE_COLS.join(', ') + ') VALUES (' + SITE_COLS.map(() => '?').join(', ') + ')',
      siteValues(f)
    );
    invalidateCache();
    res.json({ code: 0, message: '站点添加成功' });
  } catch (e) { next(e); }
});

/* ---------------- 编辑站点 ---------------- */
router.post('/:id(\\d+)/update', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const exists = await queryOne('SELECT id FROM sites WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ code: 404, message: '站点不存在' });

    const f = parseSiteFields(req.body || {});
    const sets = SITE_COLS.map(c => c + ' = ?').join(', ');
    await query('UPDATE sites SET ' + sets + ' WHERE id = ?', [...siteValues(f), id]);
    invalidateCache();
    res.json({ code: 0, message: '站点已更新' });
  } catch (e) { next(e); }
});

/* ---------------- 删除站点 ---------------- */
router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM sites WHERE id = ?', [id]);
    await query('DELETE FROM status_history WHERE site_id = ?', [id]);
    await query('DELETE FROM fault_logs WHERE site_id = ?', [id]);
    removeSiteMemory(id); // 同步清理内存中的站点状态
    invalidateCache();
    res.json({ code: 0, message: '站点已删除' });
  } catch (e) { next(e); }
});

module.exports = router;
