/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolvePostgresConnection(connectionInfo = {}) {
  const source =
    connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const connectionString = String(
    source?.connection_string || source?.connectionString || "",
  ).trim();

  let host = String(source?.host || source?.ip || "").trim();
  let port = Number(source?.port || 5432);
  let user = String(source?.username || source?.user || "").trim();
  let password = String(source?.password || "").trim();
  let database = String(source?.database || source?.db || "").trim();

  if (connectionString) {
    try {
      const url = new URL(connectionString);
      host = host || String(url.hostname || "").trim();
      port = Number.isFinite(port) && port > 0 ? port : Number(url.port || 5432);
      user = user || decodeURIComponent(String(url.username || ""));
      password = password || decodeURIComponent(String(url.password || ""));
      database = database || String(url.pathname || "").replace(/^\/+/, "").trim();
    } catch {
      // keep plain fields
    }
  }

  const timeoutMs = Math.max(
    1000,
    Number(source?.timeout_ms || source?.timeoutMs || 30000),
  );

  return {
    connectionString,
    host: host || "127.0.0.1",
    port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 5432,
    user,
    password,
    database,
    timeoutMs,
  };
}

async function importPg() {
  try {
    const mod = await import("pg");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

const postgresPools = new Map();

function buildPostgresPoolKey(conn = {}) {
  return JSON.stringify({
    connectionString: conn.connectionString,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    timeoutMs: conn.timeoutMs,
  });
}

function getPostgresPool(pg, conn = {}) {
  const key = buildPostgresPoolKey(conn);
  const cached = postgresPools.get(key);
  if (cached?.pool) return cached.pool;
  const Pool = pg?.Pool;
  if (typeof Pool !== "function") return null;
  const pool = new Pool({
    connectionString: conn.connectionString || undefined,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password || undefined,
    database: conn.database,
    statement_timeout: conn.timeoutMs,
    query_timeout: conn.timeoutMs,
    connectionTimeoutMillis: conn.timeoutMs,
    idleTimeoutMillis: 60_000,
    max: 5,
  });
  postgresPools.set(key, { pool, createdAt: Date.now() });
  return pool;
}

export async function executePostgresCommand({
  command = "",
  connectionInfo = {},
} = {}) {
  const sql = String(command || "").trim();
  if (!sql) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "postgres command required",
    };
  }

  const conn = resolvePostgresConnection(connectionInfo);
  if (!conn.user) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr:
        "postgres username required (connection_info.username or connection_string)",
    };
  }
  if (!conn.database) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr:
        "postgres database required (connection_info.database or connection_string)",
    };
  }

  const pg = await importPg();
  if (typeof pg?.Pool !== "function") {
    return {
      ok: false,
      code: 501,
      stdout: "",
      stderr: "pg not installed, run: npm i pg",
    };
  }
  const pool = getPostgresPool(pg, conn);
  if (!pool) {
    return {
      ok: false,
      code: 501,
      stdout: "",
      stderr: "pg pool unavailable",
    };
  }
  try {
    const result = await pool.query({
      text: sql,
      statement_timeout: conn.timeoutMs,
      query_timeout: conn.timeoutMs,
    });
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const payload =
      rows.length > 0
        ? rows
        : {
            command: String(result?.command || ""),
            row_count: Number(result?.rowCount || 0),
          };
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: String(error?.message || error || "postgres query failed"),
    };
  }
}
