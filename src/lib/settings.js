'use strict';
/**
 * 系统业务参数服务
 * 参数存数据库 settings 表（业务参数可在线配置），读取时带 5 秒内存缓存，
 * 避免每次请求都查库。
 */
const { query } = require('../db');
const cache = require('./cache');

const CACHE_KEY = 'settings';

/** 默认业务参数（安装向导 / 首次读取兜底） */
const DEFAULT_SETTINGS = {
  slow_threshold: 1500,        // 卡顿延迟阈值(ms)
  check_interval: 60,          // 巡检间隔(秒)
  alert_streak: 3,             // 抖动抑制：连续 N 次异常才告警
  alert_cooldown: 30,          // 邮件告警冷却间隔(秒)
  history_retention_days: 30,  // 监控历史保留天数
  log_retention_days: 30,      // 日志保留天数
  cache_ttl: 5,                // 公开页面缓存 TTL(秒)
  frontend_refresh: 30,        // 前端自动刷新间隔(秒)
  max_upload_size: 16,         // SQL 备份最大上传大小(MB)
  monitor_enabled: true        // 全局监控总开关
};

/** 类型归一：布尔与数值 */
function coerce(defaultVal, strVal) {
  if (typeof defaultVal === 'boolean') {
    return strVal === '1' || strVal === true || String(strVal).toLowerCase() === 'true';
  }
  const n = parseInt(strVal, 10);
  return isNaN(n) ? 0 : n;
}

/** 读取全部业务参数（合并默认值 + 数据库覆盖） */
async function getAll() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;
  const rows = await query('SELECT skey, svalue FROM settings');
  const map = {};
  for (const r of rows) map[r.skey] = r.svalue;
  const merged = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    merged[k] = (map[k] !== undefined && map[k] !== null) ? coerce(DEFAULT_SETTINGS[k], map[k]) : DEFAULT_SETTINGS[k];
  }
  cache.set(CACHE_KEY, merged, 5000);
  return merged;
}

/** 读取单个业务参数 */
async function get(key) {
  const all = await getAll();
  return all[key];
}

/** 批量保存业务参数（仅允许白名单键） */
async function setMany(obj) {
  for (const k of Object.keys(obj)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    await query(
      'INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
      [k, String(obj[k])]
    );
  }
  cache.del(CACHE_KEY);
}

module.exports = { DEFAULT_SETTINGS, getAll, get, setMany };
