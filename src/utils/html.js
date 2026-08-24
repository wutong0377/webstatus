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

const TAG_RE = /<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z0-9-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * 富文本安全过滤（白名单方式）
 * 移除所有不在白名单的标签与危险属性，仅允许 http(s)/#/ 开头的 href。
 */
function sanitizeHtml(input) {
  return String(input || '').replace(TAG_RE, (m, tag, attrs, selfClose) => {
    const t = tag.toLowerCase();
    if (ALLOWED_TAGS.indexOf(t) === -1) return '';
    let safeAttrs = '';
    let am;
    while ((am = ATTR_RE.exec(attrs)) !== null) {
      const name = am[1].toLowerCase();
      if (ALLOWED_ATTRS.indexOf(name) === -1) continue;
      let value = (am[2] || am[3] || am[4] || '').replace(/[<>"'`]/g, '').trim();
      if (name === 'href' && !/^(https?:|\/|#)/i.test(value)) continue;
      if (name === 'target' && value !== '_blank') continue;
      if (name === 'rel' && value !== 'nofollow noopener noreferrer') continue;
      if (name === 'href' && /javascript:|data:/i.test(value)) continue;
      safeAttrs += ' ' + name + '="' + escapeHtml(value) + '"';
    }
    return '<' + t + safeAttrs + (selfClose ? ' /' : '') + '>';
  });
}

/** 截断文本 */
function truncate(str, len) {
  str = String(str || '');
  return str.length > len ? str.slice(0, len) + '…' : str;
}

module.exports = { escapeHtml, sanitizeHtml, truncate };
