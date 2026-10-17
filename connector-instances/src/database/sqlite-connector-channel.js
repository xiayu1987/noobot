/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { importDefaultOrModule, normalizeConnectionSource } from "./common-db-connector-channel.js";
import { text } from "@noobot/shared/value";

function resolveSqliteConnection(connectionInfo = {}) {
  const source = normalizeConnectionSource(connectionInfo);
  return { filePath: text(source.file_path), timeoutMs: 30000 };
}

async function importBetterSqlite3() {
  return importDefaultOrModule("better-sqlite3");
}

const sqliteDatabases = new Map();

function databaseKey(channelKey = "") {
  const key = text(channelKey);
  if (!key) throw new TypeError("sqlite connector channelKey is required");
  return key;
}

function getSqliteDatabase(Database, channelKey = "") {
  const key = databaseKey(channelKey);
  const cached = sqliteDatabases.get(key);
  if (cached?.db) return cached.db;
  const db = new Database(key);
  sqliteDatabases.set(key, { db, createdAt: Date.now() });
  return db;
}

function looksLikeQuery(sql = "") {
  return /^(select|pragma|with|explain)\b/i.test(text(sql));
}

export async function executeSqliteCommand({
  command = "",
  connectionInfo = {},
  channelKey = "",
} = {}) {
  const sql = text(command);
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
      stderr: "sqlite file_path is required",
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
    const db = getSqliteDatabase(Database, channelKey);
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

export function releaseSqliteConnection(channelKey = "") {
  const key = databaseKey(channelKey);
  const cached = sqliteDatabases.get(key);
  if (!cached?.db) return false;
  sqliteDatabases.delete(key);
  cached.db.close();
  return true;
}
