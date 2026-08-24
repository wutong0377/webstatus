'use strict';
/**
 * 时间工具
 * 数据库以 dateStrings 模式返回字符串时间，前端展示时统一走本模块。
 */

function pad(n) { return String(n).padStart(2, '0'); }

/** 格式化时间戳/Date 为 YYYY-MM-DD HH:mm:ss */
function formatDateTime(d) {
  const date = d ? new Date(d) : new Date();
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 相对时间描述（xx 秒/分钟/小时/天前） */
function timeAgo(timestamp) {
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + ' 秒前';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
  return formatDateTime(ts);
}

/** 字符串时间转毫秒时间戳 */
function toTimestamp(d) { return new Date(d).getTime(); }

/** 休眠 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 持续时间人类可读（秒 → "1小时23分"） */
function durationText(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(d + ' 天');
  if (h) parts.push(h + ' 小时');
  if (m) parts.push(m + ' 分');
  if (s || !parts.length) parts.push(s + ' 秒');
  return parts.join(' ');
}

module.exports = { formatDateTime, timeAgo, toTimestamp, sleep, durationText };
