'use strict';
/**
 * 安装向导路由（/install）
 * 仅服务未安装状态。安装完成后 app.js 对该前缀一律返回 404，本模块彻底失效。
 *
 * 数据库模式：
 *   模式 A 全新初始化：建库建表 + 写入初始业务参数
 *   模式 B 上传 SQL 备份：头部特征校验 + 清库 + 分块导入历史数据
 *
 * 安全约束：
 *   - 上传仅允许 .sql，最大 16MB，存放私有临时目录 tmp/（非 web 可访问）；
 *   - 上传后随机重命名，规避路径穿越；导入完成后立即删除临时文件；
 *   - 失败提示一律友好，不输出原始 SQL 堆栈 / 数据库底层信息。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const multer = require('multer');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { saveConfig, ROOT } = require('../config');
const { DEFAULT_SETTINGS } = require('../lib/settings');
const { splitSql } = require('../lib/backup');
const { isPrivateIp } = require('../utils/net');

const TMP_DIR = path.join(ROOT, 'tmp');
const SCHEMA_FILE = path.join(ROOT, 'schema.sql');
const VIEWS_DIR = path.join(ROOT, 'src', 'views');
const MAX_UPLOAD = 16 * 1024 * 1024; // 16MB

/* ------------------- 安装向导页面 ------------------- */
router.get('/', (req, res) => res.sendFile(path.join(VIEWS_DIR, 'install.html')));

/* ------------------- 同源校验（安装阶段 CSRF 防护） ------------------- */
/**
 * 安装向导在登录建立会话之前开放，传统 CSRF Token 机制在早期步骤（无会话）下不可用。
 * 这里对全部写请求做 Origin/Host 同源校验，并兼容反向代理场景：
 *   - Origin 与请求 Host 一致 → 放行（正常同源）；
 *   - 浏览器 Origin 是公网地址、而 Node 侧 Host 被 Nginx/宝塔代理改写为内网地址 → 放行；
 *   - Origin 与 Host 均为公网但不一致 → 判定为跨站请求，拒绝（防 CSRF 诱导完成安装）；
 *   - 无 Origin（curl/脚本）或 Origin 为 null/不可解析 → 放行，避免误伤安装流程。
 */
function isInternalHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (h === 'localhost' || h === '::1' || h.startsWith('::ffff:') || h === '') return true;
  const p = h.split('.').map(Number);
  if (p.length === 4 && p.every(n => !isNaN(n))) {
    if (p[0] === 127 || p[0] === 10 || p[0] === 0) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  }
  return false;
}

function sameOriginCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();
  let originHost;
  try { originHost = new URL(origin).host.toLowerCase(); }
  catch (e) { return next(); } // Origin 不可解析不阻断安装
  const hostHeader = String(req.headers.host || '').toLowerCase();

  if (originHost === hostHeader) return next();
  // 反代场景：Origin 为公网，Host 被改写为内网 → 放行
  if (isInternalHost(hostHeader) && !isInternalHost(originHost)) return next();
  // 其余：跨站请求，拒绝
  return res.status(403).json({ code: 403, message: '来源校验失败，请从安装向导页面操作' });
}
router.use(sameOriginCheck);

/* ------------------- 工具函数 ------------------- */

/** 将数据库错误转换为不泄露底层信息的友好提示 */
function safeMsg(e) {
  if (!e) return '操作失败';
  const code = e.code || '';
  if (code === 'ER_ACCESS_DENIED_ERROR') return '数据库用户名或密码错误';
  if (code === 'ENOTFOUND') return '无法解析主机地址，请检查数据库主机名';
  if (code === 'ECONNREFUSED') return '数据库连接被拒绝，请检查端口与 MySQL 是否已启动';
  if (code === 'ETIMEDOUT') return '数据库连接超时，请检查网络与防火墙';
  if (/unknown database/i.test(e.message || '')) return '数据库不存在，模式 A 会自动创建';
  // 仅回显业务可读信息，绝不回显原始堆栈/内部细节
  return (e.userFriendly ? e.message : '') || '操作失败';
}

/**
 * 安装向导数据库主机安全校验
 * 允许回环（127.0.0.1/::1/localhost）与公网地址；拦截解析到内网网段的主机，
 * 防止安装向导被滥用为内网 MySQL 端口/凭据扫描器。
 */
async function assertSafeDbHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return;
  let addresses = [];
  try {
    const records = await dns.lookup(h, { all: true });
    addresses = records.map(r => r.address);
  } catch (e) {
    const err = new Error('数据库主机无法解析，已拦截（请核对主机名）');
    err.userFriendly = true;
    throw err;
  }
  for (const ip of addresses) {
    const loopback = (net.isIPv4(ip) && ip.startsWith('127.')) || ip === '::1';
    if (isPrivateIp(ip) && !loopback) {
      const err = new Error('数据库主机解析到内网地址，出于安全已拦截；本机请用 127.0.0.1，外部请使用公网地址');
      err.userFriendly = true;
      throw err;
    }
  }
}

/** 连接用户配置的数据库并确保库存在（返回连接） */
async function connectForInstall(body) {
  const db = body.db || body;
  const dbName = String(db.database || 'webstatus').trim().replace(/`/g, '');
  await assertSafeDbHost(db.host);
  const conn = await mysql.createConnection({
    host: String(db.host || '127.0.0.1').trim(),
    port: Number(db.port) || 3306,
    user: String(db.user || '').trim(),
    password: String(db.password || ''),
    connectTimeout: 8000,
    dateStrings: true
  });
  await conn.query('CREATE DATABASE IF NOT EXISTS `' + dbName + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await conn.query('USE `' + dbName + '`');
  return conn;
}

/** 目录可写检查 */
function checkWritable(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const test = path.join(dir, '.wtest-' + Date.now());
    fs.writeFileSync(test, 'ok');
    fs.unlinkSync(test);
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------- 1. 环境自检 ------------------- */
router.get('/api/check', (req, res) => {
  const major = Number(process.versions.node.split('.')[0]);
  const result = {
    node: process.version,
    nodeOk: major >= 18,
    schemaFile: fs.existsSync(SCHEMA_FILE),
    tmpWritable: checkWritable(TMP_DIR),
    rootWritable: checkWritable(ROOT),
    platform: process.platform
  };
  result.ok = result.nodeOk && result.schemaFile && result.tmpWritable && result.rootWritable;
  res.json(result);
});

/* ------------------- 2. MySQL 连接测试 ------------------- */
router.post('/api/test-db', async (req, res) => {
  const { host, port, user, password, database } = req.body || {};
  let conn;
  try {
    await assertSafeDbHost(host);
    conn = await mysql.createConnection({
      host: String(host || '').trim() || '127.0.0.1',
      port: Number(port) || 3306,
      user: String(user || '').trim(),
      password: String(password || ''),
      connectTimeout: 8000
    });
    await conn.query('SELECT 1');
    const [ver] = await conn.query('SELECT VERSION() AS v');
    let dbExists = false;
    if (database) {
      const [rows] = await conn.query(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [String(database).trim()]
      );
      dbExists = rows.length > 0;
    }
    res.json({ code: 0, ok: true, version: ver[0].v, dbExists });
  } catch (e) {
    res.status(400).json({ code: 400, ok: false, message: '数据库连接失败：' + safeMsg(e) });
  } finally {
    if (conn) { try { conn.end(); } catch (_) {} }
  }
});

/* ------------------- 3A. 模式 A：全新初始化数据库 ------------------- */
router.post('/api/init-db', async (req, res) => {
  const { host, port, user, password, database } = req.body || {};
  const dbName = String(database || 'webstatus').trim().replace(/`/g, '');
  let conn;
  try {
    await assertSafeDbHost(host);
    conn = await mysql.createConnection({
      host: String(host || '').trim() || '127.0.0.1',
      port: Number(port) || 3306,
      user: String(user || '').trim(),
      password: String(password || ''),
      multipleStatements: true,
      connectTimeout: 8000
    });
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + dbName + '` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conn.query('USE `' + dbName + '`');
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    await conn.query(schemaSql);
    // 写入初始业务参数
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      await conn.query('INSERT IGNORE INTO settings (skey, svalue) VALUES (?, ?)', [k, String(DEFAULT_SETTINGS[k])]);
    }
    res.json({ code: 0, message: '数据库初始化成功（模式 A）' });
  } catch (e) {
    res.status(400).json({ code: 400, message: '初始化失败：' + safeMsg(e) });
  } finally {
    if (conn) { try { conn.end(); } catch (_) {} }
  }
});

/* ------------------- 3B-1. 模式 B：上传 SQL 备份 ------------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
      cb(null, TMP_DIR);
    },
    filename: (req, file, cb) => {
      // 随机文件名，规避路径穿越
      cb(null, crypto.randomBytes(16).toString('hex') + '.sql');
    }
  }),
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.sql') return cb(new Error('仅支持 .sql 文件'));
    const mime = file.mimetype || '';
    if (mime && !['text/plain', 'application/sql', 'application/octet-stream', 'application/x-sql'].includes(mime)) {
      return cb(new Error('文件格式不正确，仅支持纯文本 SQL 备份'));
    }
    cb(null, true);
  }
});

router.post('/api/upload-backup', (req, res) => {
  upload.single('backup')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制（默认 16MB）' : (err.message || '上传失败');
      return res.status(400).json({ code: 400, message: msg });
    }
    if (!req.file) return res.status(400).json({ code: 400, message: '请选择要上传的 .sql 备份文件' });

    // 预检头部特征，给出提示
    let head = '';
    try { head = fs.readFileSync(req.file.path, 'utf8').slice(0, 600); } catch (e) {}
    const isSystemBackup = head.includes('WebStatus Database Backup');

    // 文件路径存入 session（安装阶段仅本次会话可用）
    req.session.backupFile = req.file.path;
    req.session.backupOriginal = req.file.originalname;
    res.json({ code: 0, originalName: req.file.originalname, size: req.file.size, isSystemBackup });
  });
});

/* ------------------- 3B-2. 模式 B：执行导入恢复 ------------------- */
router.post('/api/restore-db', async (req, res) => {
  const confirm = req.body && req.body.confirmRisk;
  const force = !!(req.body && req.body.force);
  if (!(confirm === true || confirm === '1' || confirm === 'true')) {
    return res.status(400).json({ code: 400, message: '请先勾选风险确认：导入将覆盖目标数据库全部现有数据' });
  }
  const filePath = req.session.backupFile;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ code: 400, message: '未找到上传的备份文件，请重新上传' });
  }
  let conn;
  try {
    conn = await connectForInstall(req.body);
    const sqlText = fs.readFileSync(filePath, 'utf8');
    // 头部特征校验：仅接受本系统导出的备份；勾选「强制导入（兼容旧库）」可跳过（管理员自担风险）
    if (!force && !sqlText.slice(0, 600).includes('WebStatus Database Backup')) {
      return res.status(400).json({ code: 400, message: '文件头部校验失败：这不是本系统导出的备份文件，已拒绝导入' });
    }
    if (force && !sqlText.slice(0, 600).includes('WebStatus Database Backup')) {
      console.warn('[install] 用户选择强制导入非本系统备份，已放行（管理员自担风险）');
    }
    // 清空目标库现有表 + 分块导入
    await restoreFromConn(conn, sqlText);
    // 导入成功：删除临时文件，不留残留
    try { fs.unlinkSync(filePath); } catch (_) {}
    delete req.session.backupFile;
    delete req.session.backupOriginal;
    res.json({ code: 0, message: '备份导入成功，历史数据与全部配置已恢复' });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.userFriendly ? e.message : ('导入失败：' + safeMsg(e)) });
  } finally {
    if (conn) { try { conn.end(); } catch (_) {} }
  }
});

/** 清空目标库 + 分块执行备份 SQL */
async function restoreFromConn(conn, sqlText) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await conn.query('SHOW TABLES');
  const tKey = tables.length ? Object.keys(tables[0])[0] : null;
  for (const row of tables) {
    await conn.query('DROP TABLE IF EXISTS `' + row[tKey] + '`');
  }
  const statements = splitSql(sqlText);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

/* ------------------- 4. 管理员账号创建 ------------------- */
router.post('/api/setup-admin', async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  // 注意：管理员密码走 admin_password 独立字段。
  // req.body.password 是数据库密码（由前端展开 dbInfo 传入），绝不能当作管理员密码使用。
  const password = String((req.body && (req.body.admin_password || req.body.adminPass)) || '');
  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ code: 400, message: '管理员用户名需为 3-50 个字符' });
  }
  if (password.length < 6 || password.length > 72) {
    return res.status(400).json({ code: 400, message: '密码长度需为 6-72 位' });
  }
  let conn;
  try {
    const hash = await bcrypt.hash(password, 10);
    conn = await connectForInstall(req.body);
    // 幂等：覆盖旧管理员（模式 B 恢复后同样有效）
    await conn.query('DELETE FROM admin');
    await conn.query('INSERT INTO admin (username, password_hash) VALUES (?, ?)', [username, hash]);
    res.json({ code: 0, message: '管理员账号创建成功' });
  } catch (e) {
    res.status(400).json({ code: 400, message: '创建管理员失败：' + safeMsg(e) });
  } finally {
    if (conn) { try { conn.end(); } catch (_) {} }
  }
});

/* ------------------- 4. 系统参数保存 ------------------- */
const PARAM_KEYS = ['slow_threshold', 'check_interval', 'alert_streak', 'alert_cooldown',
  'history_retention_days', 'log_retention_days', 'cache_ttl', 'frontend_refresh'];

router.post('/api/save-params', async (req, res) => {
  const body = req.body || {};
  let conn;
  try {
    conn = await connectForInstall(body);
    for (const k of PARAM_KEYS) {
      const v = Number(body[k]);
      if (isNaN(v)) continue;
      await conn.query(
        'INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)',
        [k, String(v)]
      );
    }
    res.json({ code: 0, message: '系统参数已保存' });
  } catch (e) {
    res.status(400).json({ code: 400, message: '保存系统参数失败：' + safeMsg(e) });
  } finally {
    if (conn) { try { conn.end(); } catch (_) {} }
  }
});

/* ------------------- 4. SMTP 配置暂存（最终写入 config.json） ------------------- */
router.post('/api/save-smtp', (req, res) => {
  const s = (req.body && req.body.smtp) || {};
  req.session.installSmtp = {
    enabled: !!(s.enabled === true || s.enabled === '1' || s.enabled === 'on'),
    host: String(s.host || '').trim(),
    port: Number(s.port) || 465,
    secure: !(s.secure === '0' || s.secure === false || s.secure === 'false'),
    user: String(s.user || '').trim(),
    pass: String(s.pass || ''),
    from_name: String(s.from_name || 'WebStatus').trim(),
    from_email: String(s.from_email || '').trim()
  };
  res.json({ code: 0, message: 'SMTP 配置已保存' });
});

/* ------------------- 5. 完成安装：生成 config.json ------------------- */
router.post('/api/finish', (req, res) => {
  const body = req.body || {};
  const sessionSmtp = req.session.installSmtp || {};
  const smtp = body.smtp || {};
  const finalSmtp = {
    enabled: (smtp.enabled !== undefined) ? !!(smtp.enabled === true || smtp.enabled === '1' || smtp.enabled === 'on') : sessionSmtp.enabled,
    host: String((smtp.host !== undefined ? smtp.host : sessionSmtp.host) || '').trim(),
    port: Number(smtp.port !== undefined ? smtp.port : sessionSmtp.port) || 465,
    secure: (smtp.secure !== undefined) ? !(smtp.secure === '0' || smtp.secure === false || smtp.secure === 'false') : sessionSmtp.secure,
    user: String((smtp.user !== undefined ? smtp.user : sessionSmtp.user) || '').trim(),
    pass: String((smtp.pass !== undefined ? smtp.pass : sessionSmtp.pass) || ''),
    from_name: String((smtp.from_name !== undefined ? smtp.from_name : sessionSmtp.from_name) || 'WebStatus').trim(),
    from_email: String((smtp.from_email !== undefined ? smtp.from_email : sessionSmtp.from_email) || '').trim()
  };

  const db = body.db || body.database || {};
  const finalConfig = {
    app: {
      name: 'WebStatus',
      port: Number((body.app && body.app.port) || 3000),
      base_url: String((body.app && body.app.base_url) || '').trim(),
      session_secret: crypto.randomBytes(48).toString('hex'),
      cookie_secure: !!((body.app && body.app.cookie_secure) === true || (body.app && body.app.cookie_secure) === '1')
    },
    database: {
      host: String(db.host || '127.0.0.1').trim(),
      port: Number(db.port) || 3306,
      user: String(db.user || '').trim(),
      password: String(db.password || ''),
      database: String(db.database || 'webstatus').trim()
    },
    smtp: finalSmtp,
    installed: true
  };

  saveConfig(finalConfig);
  delete req.session.backupFile;
  delete req.session.installSmtp;
  res.json({ code: 0, message: '安装完成，请重启服务后登录后台', needRestart: true });
});

module.exports = router;
