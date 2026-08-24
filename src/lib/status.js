'use strict';
/**
 * 四色状态体系与状态判定
 *   1 正常(绿) 2 卡顿(橙) 3 离线(红) 4 维修(蓝)
 * 判定规则：
 *   - 探测失败 / 4xx / 5xx  => 离线
 *   - 访问成功但延迟超过阈值 => 卡顿
 *   - 其余 => 正常
 *   - 维修模式由后台开关强制覆盖为 4，忽略探测结果、不触发告警
 */
const STATUS = {
  UP: 1,
  SLOW: 2,
  DOWN: 3,
  MAINTENANCE: 4
};

const STATUS_TEXT = { 1: '正常', 2: '卡顿', 3: '离线', 4: '维修' };

/** 根据探测结果与卡顿阈值判定状态 */
function judgeStatus(probe, slowThresholdMs) {
  if (!probe.ok) {
    return {
      status: STATUS.DOWN,
      httpCode: probe.httpCode || 0,
      errorCode: probe.errorCode || 'PROBE_ERROR',
      errorMsg: probe.errorMsg || '探测失败'
    };
  }
  // HTTP 4xx / 5xx 视为离线（对探测请求而言该服务不可用）
  if (probe.httpCode >= 400) {
    return {
      status: STATUS.DOWN,
      httpCode: probe.httpCode,
      errorCode: 'HTTP_' + probe.httpCode,
      errorMsg: 'HTTP 状态码异常: ' + probe.httpCode
    };
  }
  // 延迟超过卡顿阈值
  if (probe.delay >= Number(slowThresholdMs)) {
    return { status: STATUS.SLOW, httpCode: probe.httpCode, errorCode: '', errorMsg: '' };
  }
  return { status: STATUS.UP, httpCode: probe.httpCode, errorCode: '', errorMsg: '' };
}

module.exports = { STATUS, STATUS_TEXT, judgeStatus };
