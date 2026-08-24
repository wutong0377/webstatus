'use strict';
/**
 * MySQL 连接池
 * 全部数据库操作必须使用本模块提供的 query/queryOne/transaction，
 * 统一走参数化预编译查询（mysql2 的 execute），禁止字符串拼接 SQL。
 */
const mysql = require('mysql2/promise');
const { config } = require('./config');

let pool = null;

/** 创建连接池（仅安装完成后调用） */
function createPool(cfg) {
  const c = cfg || config.database;
  pool = mysql.createPool({
    host: c.host,
    port: Number(c.port) || 3306,
    user: c.user,
    password: c.password || '',
    database: c.database,
    charset: 'utf8mb4',
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    // 返回 DATETIME 为字符串，避免时区转换导致的数据偏差
    dateStrings: true
  });
  return pool;
}

/** 获取连接池（未初始化时返回 null） */
function getPool() {
  return pool;
}

/** 测试连接是否可用 */
async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

/**
 * 参数化查询
 * @param {string} sql  SQL（占位符 ?）
 * @param {Array}  params 参数数组
 * @returns 查询结果行数组
 */
async function query(sql, params) {
  const [rows] = await pool.execute(sql, params || []);
  return rows;
}

/** 查询单行，不存在返回 null */
async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * 事务执行
 * @param {Function} fn  async(conn) => any，conn 可执行 conn.execute
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { createPool, getPool, testConnection, query, queryOne, transaction };
