'use strict';
/**
 * WebStatus 服务入口
 * 读取配置、启动 HTTP 服务。安装状态由 config.json 的 installed 字段决定，
 * 未安装时引导访问 /install 安装向导。
 */
const http = require('http');
const { config } = require('./config');
const { verifyCopyright } = require('./lib/copyright');

// 版权完整性校验：版权信息被改动则停止运行
if (!verifyCopyright()) {
  console.error('[copyright] 版权完整性校验失败，服务已停止');
  process.exit(1);
}

const app = require('./app');

const PORT = Number(config.app.port) || 3000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log('==============================================');
  console.log(`  ${config.app.name} 网站状态监控 服务已启动`);
  console.log(`  监听地址: http://0.0.0.0:${PORT}`);
  if (!config.installed) {
    console.log(`  安装向导: http://localhost:${PORT}/install`);
  } else {
    console.log('  状态: 已安装，/install 路由已永久禁用');
  }
  console.log('==============================================');
});

// 优雅退出
process.on('SIGINT', () => { console.log('\n正在退出...'); process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });

// 未处理异常/拒绝：只记录日志，绝不导致进程崩溃退出（避免页面 Failed to fetch）
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] 未处理的 Promise 拒绝:', reason && reason.stack || reason);
});
