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
const { getSitesLatest, removeSiteMemory } = require('../../lib/monitor');
const { requiredStr, str, url, int, bool } = require('../../utils/validate');
const { validateMonitorDomain } = require('../../utils/net');

const MAX_SITES = 10;

/** 站点/公告变更后失效公开缓存 */
function invalidateCache() {
  cache.delPrefix('pub_status');
  cache.delPrefix('pub_site_');
  cache.delPrefix('pub_notices');
}

/* ---------------- 站点列表（含最新状态） ---------------- */
router.get('/', async (req, res, next) => {
  try {
    const data = await getSitesLatest();
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

/* ---------------- 新增站点 ---------------- */
router.post('/create', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = requiredStr(body.name, 100, '站点名称');
    const domain = validateMonitorDomain(body.domain);
    const description = str(body.description, 500, '站点简介');
    const seoTitle = str(body.seo_title, 200, 'SEO 标题');
    const seoDesc = str(body.seo_desc, 500, 'SEO 描述');
    const seoKeywords = str(body.seo_keywords, 500, 'SEO 关键词');
    const iconUrl = body.icon_url ? url(body.icon_url, '站点图标') : '';
    const enabled = bool(body.enabled);
    const maintenance = bool(body.maintenance);
    const maintenanceNote = str(body.maintenance_note, 500, '维修备注');
    const sort = int(body.sort, { min: 0, max: 9999, name: '排序' });

    const cnt = await queryOne('SELECT COUNT(*) AS c FROM sites');
    if (Number(cnt.c) >= MAX_SITES) {
      return res.status(400).json({ code: 400, message: '站点数量已达上限（最多 ' + MAX_SITES + ' 个），请删除后再添加' });
    }

    await query(
      'INSERT INTO sites (name, domain, description, seo_title, seo_desc, seo_keywords, icon_url, enabled, maintenance, maintenance_note, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [name, domain, description, seoTitle, seoDesc, seoKeywords, iconUrl, enabled ? 1 : 0, maintenance ? 1 : 0, maintenanceNote, sort]
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

    const body = req.body || {};
    const name = requiredStr(body.name, 100, '站点名称');
    const domain = validateMonitorDomain(body.domain);
    const description = str(body.description, 500, '站点简介');
    const seoTitle = str(body.seo_title, 200, 'SEO 标题');
    const seoDesc = str(body.seo_desc, 500, 'SEO 描述');
    const seoKeywords = str(body.seo_keywords, 500, 'SEO 关键词');
    const iconUrl = body.icon_url ? url(body.icon_url, '站点图标') : '';
    const enabled = bool(body.enabled);
    const maintenance = bool(body.maintenance);
    const maintenanceNote = str(body.maintenance_note, 500, '维修备注');
    const sort = int(body.sort, { min: 0, max: 9999, name: '排序' });

    await query(
      'UPDATE sites SET name=?, domain=?, description=?, seo_title=?, seo_desc=?, seo_keywords=?, icon_url=?, enabled=?, maintenance=?, maintenance_note=?, sort=? WHERE id=?',
      [name, domain, description, seoTitle, seoDesc, seoKeywords, iconUrl, enabled ? 1 : 0, maintenance ? 1 : 0, maintenanceNote, sort, id]
    );
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
