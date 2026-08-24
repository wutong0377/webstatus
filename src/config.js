'use strict';
/**
 * 配置加载器
 * 负责读取根目录 config.json（保存数据库 / SMTP 凭证等敏感信息，已加入 .gitignore），
 * 并提供默认值兜底。安装向导完成时通过 saveConfig() 写入。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, 'config.json');

// 默认配置（未安装 / 字段缺失时兜底）
const DEFAULTS = {
  app: {
    name: 'WebStatus',
    port: 3000,
    base_url: '',
    session_secret: '',
    cookie_secure: false
  },
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'webstatus',
    password: '',
    database: 'webstatus'
  },
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from_name: 'WebStatus',
    from_email: ''
  },
  installed: false
};

/** 深度合并：extra 覆盖 base，保留 base 中 extra 未提供的键 */
function deepMerge(base, extra) {
  const out = {};
  for (const k of Object.keys(base)) {
    const bv = base[k];
    const ev = extra && extra[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && ev && typeof ev === 'object' && !Array.isArray(ev)) {
      out[k] = deepMerge(bv, ev);
    } else {
      out[k] = ev !== undefined ? ev : bv;
    }
  }
  return out;
}

/** 读取 config.json 并合并默认值 */
function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('[config] 读取 config.json 失败，已使用默认配置:', e.message);
    }
  }
  return deepMerge(DEFAULTS, file);
}

/** 当前配置（模块级单例） */
const config = loadConfig();

/**
 * 保存配置：将 partial 深度合并进现有配置并写回 config.json
 * @param {object} partial 需要更新的配置片段
 */
function saveConfig(partial) {
  const merged = deepMerge(config, partial);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  // 更新内存单例
  Object.keys(merged).forEach(k => { config[k] = merged[k]; });
  return config;
}

module.exports = { config, saveConfig, CONFIG_PATH, ROOT, DEFAULTS };
