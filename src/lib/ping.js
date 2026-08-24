'use strict';
/**
 * 后端 ping：调用系统 ping 命令解析延迟，兼容 Linux / Windows。
 * 说明：
 *   - 原生 ICMP 需要 root/管理员权限，故采用 spawn 系统 ping 二进制；
 *   - 多数公网站点禁 ping（防火墙丢弃 ICMP），此时返回 ok=false，
 *     系统会以 HTTP 探测结果为准，ping 仅作为延迟参考。
 */
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

/**
 * 执行 ping 并解析平均延迟
 * @param {string} host 主机名
 * @param {number} timeoutMs 超时
 * @returns {Promise<{ok:boolean, delay:number}>}
 */
function ping(host, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const args = IS_WIN
      ? ['-n', '2', '-w', String(Math.min(2000, timeoutMs)), host]
      : ['-c', '2', '-W', '2', host];
    execFile('ping', args, { timeout: timeoutMs + 1000, windowsHide: true }, (err, stdout) => {
      const ms = parsePingTime(stdout || '');
      if (ms !== null) return resolve({ ok: true, delay: ms });
      resolve({ ok: false, delay: 0 });
    });
  });
}

/** 从 ping 输出中解析延迟毫秒数 */
function parsePingTime(text) {
  // Windows: 时间=30ms / time=30ms / time<1ms
  let m = text.match(/[=:]\s*(\d+(?:\.\d+)?)\s*ms/i);
  if (m) return Math.round(parseFloat(m[1]));
  // Linux: time=30.1 ms / time<1 ms
  m = text.match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

module.exports = { ping, parsePingTime };
