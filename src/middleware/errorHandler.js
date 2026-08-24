'use strict';
/**
 * 全局错误处理中间件
 * 生产环境不对外输出错误堆栈；错误仅写入服务端日志，前端只返回友好提示。
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');
const { formatDateTime } = require('../utils/time');

/** 追加错误到日志文件 */
function logError(err, req) {
  const line = `[${formatDateTime()}] ${req ? req.method + ' ' + req.originalUrl + ' | ' : ''}${err.stack || err.message || err}\n`;
  try {
    const logDir = path.join(ROOT, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'error.log'), line, 'utf8');
  } catch (e) {
    // 日志写入失败时不再抛出，避免连锁错误
  }
}

const errorHandler = (err, req, res, next) => {
  logError(err, req);
  const status = err.status || 500;
  // 已有响应时交给默认处理
  if (res.headersSent) return next(err);
  // 业务错误（status<500，如参数校验失败）返回具体提示；
  // 内部错误统一返回友好信息，细节只写服务端日志，绝不外泄堆栈/内部结构
  const msg = status < 500 ? (err.message || '请求失败') : '服务器内部错误，请稍后再试';
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ code: status, message: msg });
  }
  res.status(status).send(msg);
};

module.exports = { errorHandler, logError };
