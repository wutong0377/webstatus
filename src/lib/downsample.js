'use strict';
/**
 * 历史数据降采样聚合
 * 大范围历史图表查询时，把海量原始记录按时间分桶，每桶取平均延迟 + 最后状态，
 * 最多返回 maxPoints 个点，避免给前端下发海量原始数据。
 */
function downsample(rows, maxPoints = 120) {
  if (!rows || !rows.length) return [];
  if (rows.length <= maxPoints) return rows;
  const bucketSize = Math.ceil(rows.length / maxPoints);
  const out = [];
  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucket = rows.slice(i, i + bucketSize);
    const sumDelay = bucket.reduce((s, r) => s + (Number(r.delay) || 0), 0);
    const last = bucket[bucket.length - 1];
    out.push({
      id: last.id,
      site_id: last.site_id,
      checked_at: last.checked_at,
      status: last.status,
      delay: Math.round(sumDelay / bucket.length),
      http_code: last.http_code,
      error_code: last.error_code,
      error_msg: last.error_msg
    });
  }
  return out;
}

module.exports = { downsample };
