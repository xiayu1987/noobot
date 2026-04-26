/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveSqliteConnection(connectionInfo = {}) {
  const source =
    connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
  const connectionString = String(
    source?.connection_string || source?.connectionString || "",
  ).trim();
  let filePath = String(
    source?.file_path || source?.filePath || source?.database || source?.db || "",
  ).trim();

  if (!filePath && connectionString) {
    if (connectionString === ":memory:") {
      filePath = ":memory:";
    } else if (connectionString.startsWith("sqlite://")) {
      filePath = connectionString.replace(/^sqlite:\/\//i, "").trim();
    } else if (connectionString.startsWith("file:")) {
      filePath = connectionString.replace(/^file:/i, "").trim();
    }
  }

  const timeoutMs = Math.max(
    1000,
    Number(source?.timeout_ms || source?.timeoutMs || 30000),
  );
  return { filePath, timeoutMs };
}

async function importBetterSqlite3() {
  try {
    const mod = await import("better-sqlite3");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

const sqliteDatabases = new Map();

function getSqliteDatabase(Database, conn = {}) {
  const key = String(conn?.filePath || "").trim();
  if (!key) return null;
  const cached = sqliteDatabases.get(key);
  if (cached?.db) return cached.db;
  const db = new Database(key);
  sqliteDatabases.set(key, { db, createdAt: Date.now() });
  return db;
}

function looksLikeQuery(sql = "") {
  return /^(select|pragma|with|explain)\b/i.test(String(sql || "").trim());
}

export async function executeSqliteCommand({
  command = "",
  connectionInfo = {},
} = {}) {
  const sql = String(command || "").trim();
  if (!sql) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "sqlite command required",
    };
  }

  const conn = resolveSqliteConnection(connectionInfo);
  if (!conn.filePath) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "sqlite file_path required (connection_info.file_path or connection_string)",
    };
  }

  const Database = await importBetterSqlite3();
  if (typeof Database !== "function") {
    return {
      ok: false,
      code: 501,
      stdout: "",
      stderr: "better-sqlite3 not installed, run: npm i better-sqlite3",
    };
  }

  try {
    const db = getSqliteDatabase(Database, conn);
    if (!db) {
      return {
        ok: false,
        code: 500,
        stdout: "",
        stderr: "sqlite database init failed",
      };
    }
    db.pragma(`busy_timeout = ${conn.timeoutMs}`);
    if (looksLikeQuery(sql)) {
      const rows = db.prepare(sql).all();
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify(Array.isArray(rows) ? rows : []),
        stderr: "",
      };
    }
    const runResult = db.prepare(sql).run();
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify({
        changes: Number(runResult?.changes || 0),
        last_insert_rowid: Number(runResult?.lastInsertRowid || 0),
      }),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: String(error?.message || error || "sqlite query failed"),
    };
  }
}
