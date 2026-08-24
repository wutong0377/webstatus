'use strict';
/**
 * 版本管理与 GitHub 更新检测
 *   - GET /info        读 package.json 版本 + git 最后提交信息（失败显示 '-'）
 *   - GET /check-update 查询 GitHub Releases 最新版本，仅提示，绝不自动更新/下载
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const router = express.Router();
const { ROOT } = require('../../config');

const REPO = 'wutong0377/webstatus';
const CHECK_TIMEOUT_MS = 8000;
const GIT_TIMEOUT_MS = 5000;

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '-';
  } catch (e) {
    return '-';
  }
}

function git(args) {
  try {
    return execFileSync('git', ['-C', ROOT].concat(args), {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (e) {
    return '';
  }
}

/* ---------------- 版本信息 ---------------- */
router.get('/info', (req, res) => {
  res.json({
    code: 0,
    data: {
      version: readVersion(),
      gitCommit: git(['rev-parse', '--short', 'HEAD']) || '-',
      gitCommitAt: git(['log', '-1', '--format=%cd']) || '-'
    }
  });
});

/* ---------------- 检查更新 ---------------- */
router.get('/check-update', async (req, res) => {
  try {
    if (typeof fetch !== 'function') {
      return res.json({ code: 0, data: { error: '当前 Node 环境不支持更新检测（需 Node 18+）' } });
    }
    const resp = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { 'User-Agent': 'WebStatus/' + readVersion() },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    });
    if (!resp.ok) {
      return res.json({ code: 0, data: { error: '检查更新失败（GitHub 返回 ' + resp.status + '）' } });
    }
    const rel = await resp.json();
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    const current = readVersion();
    const hasUpdate = latest !== '' && current !== '-' && latest !== current;
    res.json({
      code: 0,
      data: {
        current,
        latest,
        hasUpdate,
        url: rel.html_url || ('https://github.com/' + REPO + '/releases')
      }
    });
  } catch (e) {
    // 网络异常 / 超时：友好提示，不影响主流程
    res.json({ code: 0, data: { error: '检查更新失败，请稍后再试' } });
  }
});

module.exports = router;
