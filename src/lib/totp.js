'use strict';
/**
 * TOTP（RFC 6238）时间基一次性口令实现
 * 仅依赖 Node 内置 crypto，零第三方依赖。
 * 默认参数：HMAC-SHA1 / 30 秒时间步长 / 6 位数字。
 * 密钥采用 Base32（RFC 4648，无填充），与 Google Authenticator 等主流认证器兼容。
 */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;     // 时间步长（秒）
const DIGITS = 6;      // 动态口令位数
const KEY_BYTES = 20;  // 密钥长度 160bit（推荐长度）

/** 字节数组 → Base32（RFC 4648，无填充） */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 → 字节数组（忽略非法字符与填充） */
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const buf = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = ALPHABET.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      buf.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(buf);
}

/** 生成随机 TOTP 密钥（Base32，20 字节 → 32 字符） */
function generateSecret() {
  return base32Encode(crypto.randomBytes(KEY_BYTES));
}

/** HOTP（RFC 4226）：HMAC-SHA1(counter) 动态截断 */
function hotp(keyBuffer, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(counter)), 0);
  const digest = crypto.createHmac('sha1', keyBuffer).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(bin % Math.pow(10, DIGITS)).padStart(DIGITS, '0');
}

/**
 * 生成某一时刻的 TOTP 动态口令
 * @param {string} secret Base32 密钥
 * @param {number} [timeStep] 秒级时间戳（默认当前时间）
 */
function generateTOTP(secret, timeStep) {
  const counter = Math.floor((timeStep === undefined ? Date.now() / 1000 : timeStep) / PERIOD);
  return hotp(base32Decode(secret), counter);
}

/**
 * 校验动态口令（默认前后各容差 1 个时间周期）
 * @param {string} secret  Base32 密钥
 * @param {string|number} code 用户输入的口令
 * @param {number} [window] 容差周期数
 * @returns {boolean}
 */
function verifyTOTP(secret, code, window = 1) {
  const c = String(code == null ? '' : code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const key = base32Decode(secret);
  if (!key.length) return false;
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  for (let w = -window; w <= window; w++) {
    if (hotp(key, counter + w) === c) return true;
  }
  return false;
}

module.exports = { generateSecret, generateTOTP, verifyTOTP, base32Encode, base32Decode };
