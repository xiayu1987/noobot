/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";
import { text } from "@noobot/shared/value";
import { connectorFailure, errorMessage, loadDriverModule } from "../channel-result.js";
import { queryOutput, requireConnectionSource } from "./common-db-connector-channel.js";

const SQLITE_TIMEOUT_MS = 30000;
const sqliteDatabases = new Map();

function databaseKey(channelKey) {
  const key = text(channelKey);
  if (!key) throw new TypeError("sqlite connector channelKey is required");
  return key;
}

function getSqliteDatabase(Database, channelKey, filePath) {
  const key = databaseKey(channelKey);
  const cached = sqliteDatabases.get(key);
  if (cached) return cached.db;
  const db = new Database(filePath);
  sqliteDatabases.set(key, { db, createdAt: Date.now() });
  return db;
}

function looksLikeQuery(sql) {
  return /^(select|pragma|with|explain)\b/i.test(sql);
}

export async function executeSqliteCommand({ command, connectionInfo, channelKey }) {
  const sql = text(command);
  if (!sql)
    return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "sqlite command required");
  const filePath = text(requireConnectionSource(connectionInfo).file_path);
  if (!filePath) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.CONFIG_INVALID, "sqlite file_path is required");
  }
  const loaded = await loadDriverModule("better-sqlite3");
  if (!loaded.ok) return loaded.failure;
  try {
    const db = getSqliteDatabase(loaded.driver, channelKey, filePath);
    db.pragma(`busy_timeout = ${SQLITE_TIMEOUT_MS}`);
    if (looksLikeQuery(sql)) return queryOutput(db.prepare(sql).all());
    const runResult = db.prepare(sql).run();
    return queryOutput({
      changes: runResult.changes,
      last_insert_rowid: Number(runResult.lastInsertRowid),
    });
  } catch (error) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.EXECUTION_FAILED, errorMessage(error));
  }
}

export function releaseSqliteConnection(channelKey) {
  const key = databaseKey(channelKey);
  const cached = sqliteDatabases.get(key);
  if (!cached) return false;
  sqliteDatabases.delete(key);
  cached.db.close();
  return true;
}
