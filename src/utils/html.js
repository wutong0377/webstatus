'use strict';
/**
 * HTML 转义与安全过滤（XSS 防护）
 * 所有渲染到 HTML 的动态数据必须经 escapeHtml；富文本输入经 sanitizeHtml。
 */

/** 转义 HTML 特殊字符 */
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 富文本白名单
const ALLOWED_TAGS = [
  'a', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'i', 'u', 'hr'
];
const ALLOWED_ATTRS = ['href', 'title', 'target', 'rel'];

const TAG_RE = /(<\/?)([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** 解码 HTML 实体（用于 href 协议校验，防 javascript: 实体变体） */
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&(lt|gt|amp|quot);/gi, (m, name) => ({ lt: '<', gt: '>', amp: '&', quot: '"' }[name.toLowerCase()] || m));
}

/**
 * 富文本安全过滤（白名单方式）
 * 移除所有不在白名单的标签与危险属性，仅允许 http(s)/#/ 开头的 href。
 * 安全要点：
 *   1. 未闭合标签（无 >）原样输出会绕过正则 → 处理完合法标签后，将所有剩余 < 转义；
 *   2. href 先做 HTML 实体解码再校验协议，防 javascript: 的实体变体注入。
 */
function sanitizeHtml(input) {
  let s = String(input || '');
  // 第一步：白名单处理合法闭合标签，输出用 / 占位 < > 避免被第二步转义
  s = s.replace(TAG_RE, (m, leading, tag, attrs, selfClose) => {
    const t = tag.toLowerCase();
    if (ALLOWED_TAGS.indexOf(t) === -1) return ''; // 非白名单标签（含其闭合标签）一律移除
    const isClose = leading === '</';
    // 闭合标签不允许携带属性（防御畸形输入，一律剥离）
    if (isClose) return '/' + t + '';
    let safeAttrs = '';
    let am;
    while ((am = ATTR_RE.exec(attrs)) !== null) {
      const name = am[1].toLowerCase();
      if (ALLOWED_ATTRS.indexOf(name) === -1) continue;
      let value = (am[2] || am[3] || am[4] || '').replace(/[<>"'`]/g, '').trim();
      const decoded = decodeEntities(value).toLowerCase();
      if (name === 'href' && !/^(https?:|\/|#)/i.test(decoded)) continue;
      if (name === 'href' && /(javascript|vbscript|data)\s*:/i.test(decoded)) continue;
      if (name === 'target' && value !== '_blank') continue;
      if (name === 'rel' && value !== 'nofollow noopener noreferrer') continue;
      safeAttrs += ' ' + name + '="' + escapeHtml(value) + '"';
    }
    return '' + t + safeAttrs + (selfClose ? ' /' : '') + '';
  });
  // 第二步：所有剩余未闭合/非法的 < 一律转义，杜绝未闭合标签注入
  s = s.replace(/</g, '&lt;');
  // 第三步：恢复合法标签占位符
  s = s.replace(//g, '>').replace(//g, '<');
  return s;
}

/** 截断文本 */
function truncate(str, len) {
  str = String(str || '');
  return str.length > len ? str.slice(0, len) + '…' : str;
}

module.exports = { escapeHtml, sanitizeHtml, truncate };
