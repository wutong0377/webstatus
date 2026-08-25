'use strict';
/**
 * Express 应用装配
 * 根据安装状态决定行为：
 *   - 未安装：仅开放 /install 安装向导，其余请求重定向到安装页
 *   - 已安装：/install 永久 404；初始化数据库连接池、邮件模板、巡检任务；
 *             挂载全部业务路由与页面
 */
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { config, ROOT } = require('./config');
const securityHeaders = require('./middleware/securityHeaders');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.disable('x-powered-by');
// 仅当部署在反向代理之后才信任 X-Forwarded-For，否则攻击者可伪造 IP 绕过限流/登录锁定
app.set('trust proxy', config.app.trust_proxy === true ? 1 : false);

const VIEWS = path.join(ROOT, 'src', 'views');

// 启动时清理安装阶段残留的临时上传文件（SQL 备份），不留敏感数据
const TMP_DIR = path.join(ROOT, 'tmp');
if (fs.existsSync(TMP_DIR)) {
  try {
    fs.readdirSync(TMP_DIR).forEach(f => { if (f.endsWith('.sql')) fs.unlinkSync(path.join(TMP_DIR, f)); });
  } catch (e) { /* 忽略清理失败 */ }
}

// ---------------- 全局中间件 ----------------
app.use(securityHeaders);

// POST 请求体大小限制（限流/防滥用）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Session：HttpOnly + SameSite=Lax，Secure 由配置决定（HTTPS 部署开启）
app.use(session({
  secret: config.app.session_secret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  name: 'webstatus.sid',
  cookie: {
    httpOnly: true,
    // base_url 配置为 https 时自动开启 Secure，防止会话 Cookie 走明文链路
    secure: config.app.cookie_secure === true || String(config.app.base_url || '').startsWith('https://'),
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// 静态资源
app.use('/assets', express.static(path.join(VIEWS, 'assets'), { maxAge: '1d' }));

// robots.txt：禁止搜索引擎收录后台 / 安装向导 / API（主服务器保密）
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /install\nDisallow: /api\n');
});

// ---------------- 路由装配 ----------------
if (!config.installed) {
  // 未安装：仅安装向导
  app.use('/install', require('./routes/install'));
  app.get('/', (req, res) => res.redirect('/install'));
  app.use((req, res) => res.redirect('/install'));
} else {
  // 已安装：/install 永久禁用（404），上传导入接口一并失效
  app.use('/install', (req, res) => res.status(404).send('Not Found'));

  // 初始化数据库连接池
  const { createPool } = require('./db');
  createPool(config.database);

  // 数据库迁移（旧库自动升级，向下兼容）
  require('./db/migrate').migrate().catch(e => console.error('[migrate] 数据库迁移失败:', e.message));

  // 初始化 SMTP transporter（未启用 SMTP 时无害，发送前仍会校验 enabled）
  require('./lib/mailer').createTransporter();

  // 确保默认邮件模板存在（后台可编辑）
  require('./lib/templates').ensureDefaults().catch(() => {});

  // 启动后台巡检任务
  require('./lib/monitor').startMonitor();

  // API 路由
  app.use('/api/public', require('./routes/public'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));

  // 页面路由
  app.get('/', (req, res) => res.sendFile(path.join(VIEWS, 'index.html')));
  app.get('/site/:id(\\d+)', (req, res) => res.sendFile(path.join(VIEWS, 'site.html')));

  // 后台页面
  app.get('/admin/login', (req, res) => res.sendFile(path.join(VIEWS, 'admin', 'login.html')));
  app.get(['/admin', '/admin/'], (req, res) => res.redirect('/admin/dashboard'));
  app.get('/admin/:page', (req, res) => {
    // 白名单页面，防路径穿越
    const allowed = ['dashboard', 'sites', 'notices', 'mail', 'mail-logs', 'fault-logs', 'settings', 'accounts', 'sessions', 'report', 'alerts', 'version'];
    if (!allowed.includes(req.params.page)) return res.status(404).send('Not Found');
    res.sendFile(path.join(VIEWS, 'admin', req.params.page + '.html'));
  });
}

// API 404
app.use('/api', (req, res) => res.status(404).json({ code: 404, message: '接口不存在' }));

// 全局错误处理
app.use(errorHandler);

module.exports = app;
