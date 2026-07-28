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
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

function resolvePostgresConnection(connectionInfo = {}) {
  const source = normalizeConnectionSource(connectionInfo);
  const resolved = resolveHostPortUserPasswordDatabase({
    source,
    defaultPort: 5432,
    fallbackHost: "127.0.0.1",
  });

  return {
    connectionString: resolved.connectionString,
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
    timeoutMs: normalizeTimeoutMs(source, 30000),
  };
}

async function importPg() {
  return importDefaultOrModule("pg");
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
    idleTimeoutMillis: TIME_THRESHOLDS.connectors.postgresIdleTimeoutMs,
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
