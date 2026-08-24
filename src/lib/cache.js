'use strict';
/**
 * 多级内存缓存
 * 用于缓存公开状态接口、公告、站点基础信息，降低数据库压力。
 * 注意：多进程（PM2 cluster）下内存缓存各进程独立，本项目推荐单进程 fork 模式。
 */
const store = new Map();

/** 读取缓存，过期返回 null */
function get(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expireAt) {
    store.delete(key);
    return null;
  }
  return item.value;
}

/** 写入缓存 */
function set(key, value, ttlMs) {
  store.set(key, { value, expireAt: Date.now() + ttlMs });
}

/** 删除缓存 */
function del(key) { store.delete(key); }

/** 按前缀批量失效（站点/公告变更时调用） */
function delPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** 清空全部缓存 */
function clear() { store.clear(); }

/** 清理全部过期项（可周期调用） */
function sweep() {
  const now = Date.now();
  for (const [key, item] of store) {
    if (now > item.expireAt) store.delete(key);
  }
}

/** 缓存统计 */
function stats() { return { count: store.size }; }

module.exports = { get, set, del, delPrefix, clear, sweep, stats };
