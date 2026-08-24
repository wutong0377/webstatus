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

/**
 * 根据探测结果与卡顿阈值判定状态
 * @param {object} probe 探测结果
 * @param {number} slowThresholdMs 卡顿阈值
 * @param {number|null} expectedStatus 自定义期望 HTTP 状态码（v1.1，可为 null）
 */
function judgeStatus(probe, slowThresholdMs, expectedStatus) {
  if (!probe.ok) {
    return {
      status: STATUS.DOWN,
      httpCode: probe.httpCode || 0,
      errorCode: probe.errorCode || 'PROBE_ERROR',
      errorMsg: probe.errorMsg || '探测失败'
    };
  }
  // 自定义期望状态码（不限于 200，如期望 302/401 等）
  if (expectedStatus && Number(expectedStatus) > 0) {
    if (probe.httpCode !== Number(expectedStatus)) {
      return {
        status: STATUS.DOWN,
        httpCode: probe.httpCode,
        errorCode: 'HTTP_' + probe.httpCode,
        errorMsg: 'HTTP 状态码不符合期望(' + expectedStatus + ')，实际: ' + probe.httpCode
      };
    }
    if (probe.delay >= Number(slowThresholdMs)) {
      return { status: STATUS.SLOW, httpCode: probe.httpCode, errorCode: '', errorMsg: '' };
    }
    return { status: STATUS.UP, httpCode: probe.httpCode, errorCode: '', errorMsg: '' };
  }
  // 默认：HTTP 4xx / 5xx 视为离线
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
