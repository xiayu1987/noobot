/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  importDefaultOrModule,
  normalizeConnectionSource,
  resolveDatabaseConnection,
} from "./common-db-connector-channel.js";

function resolveMysqlConnection(connectionInfo = {}) {
  const source = normalizeConnectionSource(connectionInfo);
  const resolved = resolveDatabaseConnection({
    source,
    defaultPort: 3306,
  });

  return {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
    timeoutMs: 30000,
    poolLimit: 4,
  };
}

async function importMysqlPromise() {
  return importDefaultOrModule("mysql2/promise");
}

const mysqlPools = new Map();

function poolKey(channelKey = "") {
  const key = String(channelKey || "").trim();
  if (!key) throw new TypeError("mysql connector channelKey is required");
  return key;
}

function getMysqlPool(mysql, conn = {}, channelKey = "") {
  const key = poolKey(channelKey);
  const cached = mysqlPools.get(key);
  if (cached?.pool) return cached.pool;
  const pool = mysql.createPool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password || undefined,
    database: conn.database || undefined,
    waitForConnections: true,
    connectionLimit: conn.poolLimit,
    queueLimit: 0,
    connectTimeout: conn.timeoutMs,
  });
  mysqlPools.set(key, { pool, createdAt: Date.now() });
  return pool;
}

export async function executeMysqlCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
} = {}) {
  const sql = String(command || "").trim();
  if (!sql) {
    return { ok: false, code: 400, stdout: "", stderr: "mysql command required" };
  }

  const conn = resolveMysqlConnection(connectionInfo);
  if (!conn.user) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "mysql username is required",
    };
  }

  const mysql = await importMysqlPromise();
  if (!mysql?.createPool) {
    return {
      ok: false,
      code: 501,
      stdout: "",
      stderr: "mysql2 not installed, run: npm i mysql2",
    };
  }
  const pool = getMysqlPool(mysql, conn, channelKey);
  try {
    const [rows] = await pool.query({
      sql,
      timeout: conn.timeoutMs,
    });
    if (Array.isArray(rows)) {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify(rows),
        stderr: "",
      };
    }
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify(rows || {}),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      code: Number(error?.errno || 1),
      stdout: "",
      stderr: String(error?.message || error || "mysql query failed"),
    };
  }
}

export async function releaseMysqlConnection(channelKey = "") {
  const key = poolKey(channelKey);
  const cached = mysqlPools.get(key);
  if (!cached?.pool) return false;
  mysqlPools.delete(key);
  await cached.pool.end();
  return true;
}
