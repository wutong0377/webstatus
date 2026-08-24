'use strict';
/**
 * 数据库备份导出 / 导入
 * 导出：遍历全部表，生成带本系统头部特征标识的 .sql 文件（含建表 + 数据）。
 * 导入：严格校验头部特征；先清空目标库现有表再分块执行；失败时友好报错，
 *       不输出原始 SQL 堆栈、不泄露数据库底层信息。
 */
const { getPool } = require('../db');

const HEADER_SIGN = 'WebStatus Database Backup';

/** 生成完整 .sql 备份文本 */
async function exportBackup() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query('SHOW TABLES');
    const tableKey = tables.length ? Object.keys(tables[0])[0] : null;
    const lines = [];
    lines.push('-- ============================================================');
    lines.push('-- ' + HEADER_SIGN);
    lines.push('-- Version: 1.0');
    lines.push('-- Generated: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('-- 仅可在 WebStatus 安装向导中使用本文件进行数据库恢复');
    lines.push('-- ============================================================');
    lines.push('SET NAMES utf8mb4;');
    lines.push('SET FOREIGN_KEY_CHECKS = 0;');

    for (const row of tables) {
      const table = row[tableKey];
      const [ct] = await conn.query('SHOW CREATE TABLE `' + table + '`');
      lines.push('');
      lines.push('-- ------------------------------------------------------------');
      lines.push('-- Table: ' + table);
      lines.push('-- ------------------------------------------------------------');
      lines.push(ct[0]['Create Table'] + ';');

      const [rows] = await conn.query('SELECT * FROM `' + table + '`');
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const parts = rows.map(r => '(' + cols.map(c => sqlValue(r[c])).join(', ') + ')');
        lines.push('INSERT INTO `' + table + '` (' + cols.map(c => '`' + c + '`').join(', ') + ') VALUES');
        lines.push(parts.join(',\n') + ';');
      }
    }
    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    return lines.join('\n');
  } finally {
    conn.release();
  }
}

/** 值转义为 SQL 字面量 */
function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
}

/**
 * 导入 SQL 备份（安装向导模式 B 使用）
 * @param {string} sqlText 备份文件全文
 */
async function importBackup(sqlText) {
  // 1. 头部特征校验：仅接受本系统导出的备份
  const head = sqlText.slice(0, 600);
  if (!head.includes(HEADER_SIGN)) {
    const err = new Error('文件头部校验失败：这不是本系统导出的备份文件，已拒绝导入');
    err.userFriendly = true;
    throw err;
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // 2. 清空目标库现有全部表（导入会覆盖现有数据）
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await conn.query('SHOW TABLES');
    const tableKey = tables.length ? Object.keys(tables[0])[0] : null;
    for (const row of tables) {
      await conn.query('DROP TABLE IF EXISTS `' + row[tableKey] + '`');
    }
    // 3. 分块逐语句执行（多语句拆分，避免超长包）
    const statements = splitSql(sqlText);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    return { tables: tables.length, statements: statements.length };
  } catch (e) {
    if (!e.userFriendly) {
      // 不输出原始 SQL 堆栈 / 数据库底层信息，只给友好提示
      const err = new Error('导入失败：SQL 执行出错，请确认备份文件完整且来自本系统。可联系管理员查看服务端日志定位。');
      err.userFriendly = true;
      throw err;
    }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * SQL 分句：过滤注释行，按分号拆分
 * 注意：本系统备份由程序导出，不含存储过程/触发器，按行拆分足够安全。
 */
function splitSql(text) {
  const clean = String(text)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('--') && !l.startsWith('#') && !l.startsWith('/*'))
    .join('\n');
  return clean
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 2)
    .map(s => (s.endsWith(';') ? s : s + ';'));
}

module.exports = { exportBackup, importBackup, HEADER_SIGN };
