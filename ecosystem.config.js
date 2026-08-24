'use strict';
/**
 * PM2 进程守护配置
 * 使用：
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # 开机自启
 * 建议使用 fork 单实例模式（内存缓存 / 定时任务均在单进程内，避免多实例重复探测）。
 */
module.exports = {
  apps: [
    {
      name: 'webstatus',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,          // 崩溃自动重启
      max_memory_restart: '300M', // 内存超限自动重启
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,                 // 日志带时间戳
      kill_timeout: 5000
    }
  ]
};
