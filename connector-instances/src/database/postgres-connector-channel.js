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

function resolvePostgresConnection(connectionInfo = {}) {
  const source = normalizeConnectionSource(connectionInfo);
  const resolved = resolveDatabaseConnection({
    source,
    defaultPort: 5432,
  });

  return {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
    timeoutMs: 30000,
  };
}

async function importPg() {
  return importDefaultOrModule("pg");
}

const postgresPools = new Map();

function poolKey(channelKey = "") {
  const key = String(channelKey || "").trim();
  if (!key) throw new TypeError("postgres connector channelKey is required");
  return key;
}

function getPostgresPool(pg, conn = {}, channelKey = "") {
  const key = poolKey(channelKey);
  const cached = postgresPools.get(key);
  if (cached?.pool) return cached.pool;
  const Pool = pg?.Pool;
  if (typeof Pool !== "function") return null;
  const pool = new Pool({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password || undefined,
    database: conn.database,
    statement_timeout: conn.timeoutMs,
    query_timeout: conn.timeoutMs,
    connectionTimeoutMillis: conn.timeoutMs,
    idleTimeoutMillis: 30000,
    max: 5,
  });
  postgresPools.set(key, { pool, createdAt: Date.now() });
  return pool;
}

export async function executePostgresCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
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
      stderr: "postgres username is required",
    };
  }
  if (!conn.database) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "postgres database is required",
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
  const pool = getPostgresPool(pg, conn, channelKey);
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

export async function releasePostgresConnection(channelKey = "") {
  const key = poolKey(channelKey);
  const cached = postgresPools.get(key);
  if (!cached?.pool) return false;
  postgresPools.delete(key);
  await cached.pool.end();
  return true;
}
