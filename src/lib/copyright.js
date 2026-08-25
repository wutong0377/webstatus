'use strict';
/**
 * 版权完整性保护（隐蔽校验）
 * 版权规范串分散拼接，通过 SHA256 哈希校验。任何一处版权数据（署名/QQ/GitHub 地址）
 * 被改动都会导致校验失败，服务端将拒绝启动（停止运行）。
 */
const crypto = require('crypto');

// 版权组成部分（分散拼接，避免明文直白）
const GIT = 'wutong0' + '377';
const NAME = '梧桐';         // 梧桐
const QQ = '3363' + '047365';
const DOM = 'github.com/' + GIT;

// 版权规范串（完整性校验基准，保持稳定）
const COPYRIGHT_STR = '© Wutong|' + NAME + '|' + QQ + '|' + DOM;

// 版权规范串 SHA256（十六进制，预计算）
const EXPECTED_HASH = '0f6c8b96bf762b980630a53615b91d2a1a258fa7fe524e3323109a89c2b21b19';

/** 校验版权是否被改动 */
function verifyCopyright() {
  const h = crypto.createHash('sha256').update(COPYRIGHT_STR).digest('hex');
  return h === EXPECTED_HASH;
}

/** 版权展示数据 */
function copyrightData() {
  return { author: NAME + ' Wutong', github: 'https://' + DOM, qq: QQ };
}

/** 页脚版权 HTML（署名链接到 GitHub 主页） */
function copyrightHTML() {
  const d = copyrightData();
  return '<a href="' + d.github + '" target="_blank" rel="noopener">© ' + d.author + '</a> · QQ ' + d.qq;
}

module.exports = { verifyCopyright, copyrightData, copyrightHTML, COPYRIGHT_STR };
