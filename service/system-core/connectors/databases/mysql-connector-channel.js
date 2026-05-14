/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  importDefaultOrModule,
  normalizeConnectionSource,
  normalizeTimeoutMs,
  resolveHostPortUserPasswordDatabase,
} from "./common-db-connector-channel.js";

function resolveMysqlConnection(connectionInfo = {}) {
  const source = normalizeConnectionSource(connectionInfo);
  const resolved = resolveHostPortUserPasswordDatabase({
    source,
    defaultPort: 3306,
    fallbackHost: "127.0.0.1",
  });

  return {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
    timeoutMs: normalizeTimeoutMs(source, 30000),
    poolLimit: Math.max(
      1,
      Number(source?.pool_limit || source?.poolLimit || 4),
    ),
  };
}

async function importMysqlPromise() {
  return importDefaultOrModule("mysql2/promise");
}

const mysqlPools = new Map();

function buildMysqlPoolKey(conn = {}) {
  return JSON.stringify({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    timeoutMs: conn.timeoutMs,
    poolLimit: conn.poolLimit,
  });
}

function getMysqlPool(mysql, conn = {}) {
  const key = buildMysqlPoolKey(conn);
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
      stderr: "mysql username required (connection_info.username or connection_string)",
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
  const pool = getMysqlPool(mysql, conn);
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
