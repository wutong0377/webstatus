'use strict';
/**
 * 通用输入校验工具
 * 所有用户输入在写入数据库 / 使用前必须经过这里校验。
 */

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/** 判断值是否为空 */
function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * 字符串字段：去空格 + 长度上限
 * @param {*} v 输入值
 * @param {number} maxLen 最大长度
 * @param {string} name 字段中文名（用于错误提示）
 * @returns 处理后字符串
 */
function str(v, maxLen, name) {
  v = (v === undefined || v === null) ? '' : String(v);
  v = v.trim();
  if (maxLen && v.length > maxLen) {
    throw new Error((name || '字段') + ' 长度不能超过 ' + maxLen + ' 个字符');
  }
  return v;
}

/** 必填字符串 */
function requiredStr(v, maxLen, name) {
  const s = str(v, maxLen, name);
  if (!s) throw new Error((name || '字段') + ' 不能为空');
  return s;
}

/** 邮箱格式校验（小写归一） */
function email(v, name) {
  v = String(v || '').trim().toLowerCase();
  if (!EMAIL_RE.test(v)) throw new Error((name || '邮箱') + ' 格式不正确');
  return v;
}

/** URL 格式校验（允许空） */
function url(v, name) {
  v = String(v || '').trim();
  if (v && !URL_RE.test(v)) {
    throw new Error((name || 'URL') + ' 格式不正确，需以 http:// 或 https:// 开头');
  }
  return v;
}

/**
 * 整数校验
 * @param {*} v 输入值
 * @param {object} opts { min, max, def }
 */
function int(v, opts = {}) {
  const { min, max, def = 0, name = '数值' } = opts;
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  if (min !== undefined && n < min) throw new Error(name + ' 不能小于 ' + min);
  if (max !== undefined && n > max) throw new Error(name + ' 不能大于 ' + max);
  return n;
}

/** 布尔值解析（兼容字符串 '1'/'0'/'true'/'on'） */
function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

/** 密码强度：长度 6-72（bcrypt 限制） */
function password(v, name) {
  v = String(v || '');
  if (v.length < 6) throw new Error((name || '密码') + ' 长度至少 6 位');
  if (v.length > 72) throw new Error((name || '密码') + ' 长度不能超过 72 位');
  return v;
}

module.exports = { isEmpty, str, requiredStr, email, url, int, bool, password, EMAIL_RE, URL_RE };
