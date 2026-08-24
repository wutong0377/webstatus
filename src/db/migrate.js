'use strict';
/**
 * 数据库迁移机制
 * 负责把已有数据库从旧版本平滑升级到新版本（向下兼容），也用于新装后补齐结构。
 *
 * 原理：
 *   - schema_migrations 表记录已执行的迁移版本号；
 *   - 启动时按版本顺序执行未执行的迁移；
 *   - 每个迁移只在第一次运行时执行一次，避免重复 ALTER 报错。
 *
 * 说明：v1.0 的基础表结构视为 version 1；v1.1 及以后的改动以迁移形式叠加，
 * 因此老库无需手动改结构，直接更新代码重启即可自动升级。
 */
const { getPool } = require('../db');

/** 迁移列表（按 version 升序执行） */
const MIGRATIONS = [
  {
    version: 2,
    name: 'v1.1 结构扩展：探测/告警/RBAC/证书/DNS/报表',
    up: async (conn) => {
      // ---------- sites 扩展：探测与告警配置 ----------
      await conn.query("ALTER TABLE sites ADD COLUMN alert_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '独立告警开关'");
      await conn.query('ALTER TABLE sites ADD COLUMN expected_status INT NULL COMMENT \'期望HTTP状态码(默认2xx)\'');
      await conn.query("ALTER TABLE sites ADD COLUMN check_dns TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否DNS记录监控'");
      await conn.query("ALTER TABLE sites ADD COLUMN check_cert TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否SSL证书监控'");
      await conn.query('ALTER TABLE sites ADD COLUMN cert_warn_days INT NOT NULL DEFAULT 30 COMMENT \'证书过期提前预警天数\'');
      await conn.query("ALTER TABLE sites ADD COLUMN check_tcp TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否TCP端口检测'");
      await conn.query('ALTER TABLE sites ADD COLUMN tcp_port INT NULL COMMENT \'TCP检测端口\'');
      await conn.query("ALTER TABLE sites ADD COLUMN monitor_mode VARCHAR(10) NOT NULL DEFAULT 'http' COMMENT '监控模式: http/tcp/icmp'");

      // ---------- admin 扩展：RBAC + 2FA ----------
      await conn.query("ALTER TABLE admin ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'admin' COMMENT 'admin普通/super超级/readonly只读'");
      await conn.query("ALTER TABLE admin ADD COLUMN display_name VARCHAR(50) NOT NULL DEFAULT '' COMMENT '显示名称'");
      await conn.query("ALTER TABLE admin ADD COLUMN 2fa_secret VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'TOTP密钥'");
      await conn.query('ALTER TABLE admin ADD COLUMN 2fa_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT \'是否启用2FA\'');
      await conn.query('ALTER TABLE admin ADD COLUMN last_login_at DATETIME NULL');
      await conn.query("ALTER TABLE admin ADD COLUMN last_login_ip VARCHAR(45) NOT NULL DEFAULT ''");

      // ---------- 会话管理表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        admin_id INT UNSIGNED NOT NULL,
        session_id VARCHAR(128) NOT NULL,
        user_agent VARCHAR(255) NOT NULL DEFAULT '',
        ip VARCHAR(45) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked TINYINT(1) NOT NULL DEFAULT 0,
        KEY idx_sess_admin (admin_id),
        KEY idx_sess_sid (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话'`);

      // ---------- 维护窗口表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS maintenance_windows (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_id INT UNSIGNED NOT NULL,
        title VARCHAR(100) NOT NULL,
        start_at DATETIME NOT NULL,
        end_at DATETIME NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_mw_site (site_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='维护计划窗口'`);

      // ---------- DNS 记录规则表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS dns_rules (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_id INT UNSIGNED NOT NULL,
        record_type VARCHAR(10) NOT NULL COMMENT 'A/AAAA/CNAME/MX',
        expected TEXT NOT NULL COMMENT '期望记录值(每行一条)',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_dns_site (site_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='DNS记录监控规则'`);

      // ---------- SSL 证书检测记录表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS cert_checks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_id INT UNSIGNED NOT NULL,
        status TINYINT NOT NULL DEFAULT 1 COMMENT '1正常 2预警 3异常',
        issuer VARCHAR(255) NOT NULL DEFAULT '',
        subject VARCHAR(255) NOT NULL DEFAULT '',
        san TEXT,
        valid_from DATETIME NULL,
        valid_to DATETIME NULL,
        days_left INT NOT NULL DEFAULT 0,
        error_code VARCHAR(50) NOT NULL DEFAULT '',
        checked_at DATETIME NOT NULL,
        KEY idx_cert_site (site_id),
        KEY idx_cert_time (checked_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SSL证书检测'`);

      // ---------- 告警日志中心表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS alert_logs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_id INT UNSIGNED NULL,
        alert_type VARCHAR(50) NOT NULL COMMENT 'down/recover/cert/dns/tcp/webhook...',
        level TINYINT NOT NULL DEFAULT 2 COMMENT '1警告 2严重 3紧急',
        channel VARCHAR(20) NOT NULL COMMENT 'mail/webhook/qq',
        target VARCHAR(255) NOT NULL DEFAULT '',
        status TINYINT NOT NULL DEFAULT 1 COMMENT '1成功 0失败',
        error_msg VARCHAR(500) NOT NULL DEFAULT '',
        payload TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_alert_time (created_at),
        KEY idx_alert_site (site_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='告警日志中心'`);

      // ---------- Webhook 配置表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS webhooks (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        url VARCHAR(500) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        secret VARCHAR(200) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Webhook回调配置'`);

      // ---------- 手动故障事件表 ----------
      await conn.query(`CREATE TABLE IF NOT EXISTS manual_faults (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        site_id INT UNSIGNED NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        progress VARCHAR(50) NOT NULL DEFAULT '处理中',
        status TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0进行中 1已解决',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_mf_site (site_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='手动录入故障事件'`);
    }
  }
];

/**
 * 执行未执行的数据库迁移
 * 仅在连接池初始化后调用；幂等，可安全重复执行。
 */
async function migrate() {
  const pool = getPool();
  if (!pool) throw new Error('数据库连接池未初始化');
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      name VARCHAR(100) NOT NULL DEFAULT '',
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库迁移记录'`);

    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map(r => r.version));

    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await m.up(conn);
      await conn.query('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, NOW())', [m.version, m.name]);
      console.log('[migrate] 已执行迁移 v' + m.version + ': ' + m.name);
    }
  } finally {
    conn.release();
  }
}

module.exports = { migrate, MIGRATIONS };
