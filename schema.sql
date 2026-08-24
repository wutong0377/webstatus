-- =====================================================================
-- WebStatus 网站状态监控系统 - 数据库结构
-- 说明：
--   1. 本文件仅包含建表语句，不含 CREATE DATABASE / USE。
--      数据库名由安装向导根据用户配置创建（避免写死库名）。
--   2. 安装向导【模式 A 全新初始化】读取本文件逐条执行。
--   3. 所有查询均基于本结构的索引设计，禁止全表扫描。
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 监控站点表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sites` (
  `id`              INT UNSIGNED    NOT NULL AUTO_INCREMENT COMMENT '站点ID',
  `name`            VARCHAR(100)    NOT NULL DEFAULT ''    COMMENT '站点显示名称',
  `domain`          VARCHAR(255)    NOT NULL               COMMENT '站点域名/完整URL',
  `description`     VARCHAR(500)    NOT NULL DEFAULT ''    COMMENT '站点简介',
  `seo_title`       VARCHAR(200)    NOT NULL DEFAULT ''    COMMENT 'SEO 标题',
  `seo_desc`        VARCHAR(500)    NOT NULL DEFAULT ''    COMMENT 'SEO 描述',
  `seo_keywords`    VARCHAR(500)    NOT NULL DEFAULT ''    COMMENT 'SEO 关键词',
  `icon_url`        VARCHAR(500)    NOT NULL DEFAULT ''    COMMENT '站点图标(仅外部URL)',
  `enabled`         TINYINT(1)      NOT NULL DEFAULT 1     COMMENT '启用监控 1是 0否',
  `maintenance`     TINYINT(1)      NOT NULL DEFAULT 0     COMMENT '维修模式 1开 0关',
  `maintenance_note` VARCHAR(500)   NOT NULL DEFAULT ''    COMMENT '维修备注',
  `sort`            INT             NOT NULL DEFAULT 0     COMMENT '展示排序',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_sites_sort` (`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='监控站点';

-- ---------------------------------------------------------------------
-- 状态历史表（每次探测写入一条，按站点+时间索引）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `status_history` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `site_id`      INT UNSIGNED    NOT NULL COMMENT '站点ID',
  `status`       TINYINT         NOT NULL DEFAULT 1 COMMENT '1正常 2卡顿 3离线',
  `delay`        INT             NOT NULL DEFAULT 0 COMMENT '响应耗时(ms)',
  `http_code`    INT             NULL     COMMENT 'HTTP状态码',
  `error_code`   VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '错误码(对应错误码库)',
  `error_msg`    VARCHAR(500)    NOT NULL DEFAULT '' COMMENT '错误描述',
  `checked_at`   DATETIME        NOT NULL COMMENT '检测时间',
  PRIMARY KEY (`id`),
  KEY `idx_history_site_time` (`site_id`, `checked_at`),
  KEY `idx_history_time` (`checked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='状态历史记录';

-- ---------------------------------------------------------------------
-- 故障日志表（异常持续区间记录）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fault_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `site_id`      INT UNSIGNED    NOT NULL COMMENT '站点ID',
  `fault_status` TINYINT         NOT NULL DEFAULT 3 COMMENT '2卡顿 3离线',
  `http_code`    INT             NULL     COMMENT 'HTTP状态码',
  `error_code`   VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '错误码',
  `error_msg`    VARCHAR(500)    NOT NULL DEFAULT '' COMMENT '错误描述',
  `started_at`   DATETIME        NOT NULL COMMENT '故障开始时间',
  `ended_at`     DATETIME        NULL     COMMENT '恢复时间, NULL表示进行中',
  `duration_sec` INT             NOT NULL DEFAULT 0 COMMENT '持续秒数',
  PRIMARY KEY (`id`),
  KEY `idx_fault_site` (`site_id`),
  KEY `idx_fault_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故障日志';

-- ---------------------------------------------------------------------
-- 邮件发送日志表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mail_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `to_email`   VARCHAR(255)    NOT NULL COMMENT '接收邮箱',
  `mail_type`  VARCHAR(50)     NOT NULL DEFAULT 'alert' COMMENT 'alert告警 recover恢复 test测试',
  `status`     TINYINT         NOT NULL DEFAULT 1 COMMENT '1成功 0失败',
  `error_msg`  VARCHAR(500)    NOT NULL DEFAULT '' COMMENT '失败原因',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  PRIMARY KEY (`id`),
  KEY `idx_mail_time` (`created_at`),
  KEY `idx_mail_email` (`to_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邮件发送日志';

-- ---------------------------------------------------------------------
-- 告警接收邮箱表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `recipients` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`      VARCHAR(255) NOT NULL COMMENT '接收邮箱',
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '启用 1是 0否',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_recipients_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='告警接收邮箱';

-- ---------------------------------------------------------------------
-- 公告表
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notices` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(200) NOT NULL COMMENT '公告标题',
  `content`    TEXT         NOT NULL COMMENT '公告内容',
  `is_pinned`  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '置顶 1是 0否',
  `sort`       INT          NOT NULL DEFAULT 0 COMMENT '排序(置顶内排序)',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notices_pin` (`is_pinned`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告';

-- ---------------------------------------------------------------------
-- 管理员表（密码为 bcrypt 哈希，绝不存明文）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)  NOT NULL COMMENT '管理员用户名',
  `password_hash` VARCHAR(100) NOT NULL COMMENT 'bcrypt 密码哈希',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账号';

-- ---------------------------------------------------------------------
-- 邮件模板表（告警模板 / 恢复通知模板）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mail_templates` (
  `tpl_type`   VARCHAR(20) NOT NULL COMMENT 'alert告警 recover恢复',
  `subject`    VARCHAR(200) NOT NULL COMMENT '邮件主题',
  `html`       TEXT        NOT NULL COMMENT '邮件 HTML 正文(含模板变量)',
  `updated_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tpl_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邮件模板';

-- ---------------------------------------------------------------------
-- 系统业务参数表（巡检间隔/阈值等，安装向导与后台可配置）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `skey`       VARCHAR(100) NOT NULL COMMENT '参数键',
  `svalue`     TEXT         NOT NULL COMMENT '参数值',
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`skey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统业务参数';
