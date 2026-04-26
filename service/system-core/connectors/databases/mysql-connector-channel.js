/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveMysqlConnection(connectionInfo = {}) {
  const source =
    connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const connectionString = String(
    source?.connection_string || source?.connectionString || "",
  ).trim();

  let host = String(source?.host || source?.ip || "").trim();
  let port = Number(source?.port || 3306);
  let user = String(source?.username || source?.user || "").trim();
  let password = String(source?.password || "").trim();
  let database = String(source?.database || source?.db || "").trim();

  if (connectionString) {
    try {
      const url = new URL(connectionString);
      host = host || String(url.hostname || "").trim();
      port = Number.isFinite(port) && port > 0 ? port : Number(url.port || 3306);
      user = user || decodeURIComponent(String(url.username || ""));
      password = password || decodeURIComponent(String(url.password || ""));
      database = database || String(url.pathname || "").replace(/^\/+/, "").trim();
    } catch {
      // keep plain fields
    }
  }

  return {
    host: host || "127.0.0.1",
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 3306,
    user,
    password,
    database,
    timeoutMs: Math.max(
      1000,
      Number(source?.timeout_ms || source?.timeoutMs || 30000),
    ),
    poolLimit: Math.max(
      1,
      Number(source?.pool_limit || source?.poolLimit || 4),
    ),
  };
}

async function importMysqlPromise() {
  try {
    const mod = await import("mysql2/promise");
    return mod?.default || mod;
  } catch {
    return null;
  }
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
