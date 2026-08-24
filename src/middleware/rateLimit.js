'use strict';
/**
 * 内存滑动窗口限流（自研，零依赖）
 * 用于公开接口、登录接口、后台管理接口的差异化限流。
 * 注意：单进程内存限流；PM2 cluster 下按进程独立（fork 模式可接受）。
 */
const buckets = new Map();

/**
 * 创建限流中间件
 * @param {object} opts
 *   windowMs  窗口毫秒数
 *   max       窗口内最大请求数
 *   keyFn     可选，自定义 key（默认按 IP）
 *   message   超限提示语
 */
function rateLimit(opts) {
  const { windowMs, max, keyFn, message } = opts;
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ code: 429, message: message || '请求过于频繁，请稍后再试' });
      return;
    }
    next();
  };
}

/** 周期清理过期桶，防止内存膨胀 */
function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** 重置指定 key 的限流（如登录成功后清零失败计数） */
function resetLimit(key) { buckets.delete(key); }

// 每 5 分钟自动清理一次
setInterval(cleanupRateLimits, 5 * 60 * 1000).unref();

module.exports = { rateLimit, resetLimit, cleanupRateLimits };
