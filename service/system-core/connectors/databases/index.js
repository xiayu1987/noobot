/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executePostgresCommand } from "./postgres-connector-channel.js";
import { executeMysqlCommand } from "./mysql-connector-channel.js";
import { executeSqliteCommand } from "./sqlite-connector-channel.js";
import { normalizeDatabaseType } from "../../config/index.js";

function stripSqlCommentsAndStrings(sql = "") {
  return String(sql || "")
    .replace(/'([^'\\]|\\.|'')*'/g, "''")
    .replace(/"([^"\\]|\\.|"")*"/g, "\"\"")
    .replace(/`([^`\\]|\\.)*`/g, "``")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/#[^\n\r]*/g, " ")
    .trim();
}

function shouldBlockUnsafeSql(command = "") {
  const normalizedSql = stripSqlCommentsAndStrings(command).toLowerCase();
  if (!normalizedSql) return false;
  const compactSql = normalizedSql.replace(/\s+/g, " ");
  const isUpdate = compactSql.startsWith("update ");
  const isDelete = compactSql.startsWith("delete ");
  const isSelectQuery =
    compactSql.startsWith("select ") && /\bfrom\b/.test(compactSql);
  if (!isUpdate && !isDelete && !isSelectQuery) return false;
  return !/\bwhere\b/.test(compactSql);
}

export async function executeDatabaseCommand({
  command = "",
  connectionInfo = {},
} = {}) {
  if (shouldBlockUnsafeSql(command)) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr:
        "unsafe sql blocked: SELECT/UPDATE/DELETE must include WHERE condition",
    };
  }
  const databaseType = normalizeDatabaseType(connectionInfo?.database_type || "");
  if (databaseType === "postgres") {
    return executePostgresCommand({ command, connectionInfo });
  }
  if (databaseType === "mysql") {
    return executeMysqlCommand({ command, connectionInfo });
  }
  if (databaseType === "sqlite") {
    return executeSqliteCommand({ command, connectionInfo });
  }
  return {
    ok: false,
    code: 400,
    stdout: "",
    stderr:
      "unknown database type, set connection_info.database_type as postgres/mysql/sqlite",
  };
}
