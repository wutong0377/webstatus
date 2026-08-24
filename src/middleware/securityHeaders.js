'use strict';
/**
 * 安全响应头中间件
 * 为全部响应设置基础安全头，防止 MIME 嗅探、点击劫持等风险。
 */
module.exports = function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  // 基础 CSP：允许自身 + CDN(https) + 内联样式/脚本（TailwindCDN 与内联脚本所需）
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; font-src 'self' https: data:"
  );
  next();
};
