/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executePostgresCommand, releasePostgresConnection } from "./postgres-connector-channel.js";
import { executeMysqlCommand, releaseMysqlConnection } from "./mysql-connector-channel.js";
import { executeSqliteCommand, releaseSqliteConnection } from "./sqlite-connector-channel.js";

function stripSqlCommentsAndStrings(sql = "") {
  const source = String(sql || "");
  let output = "";
  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      output += quote + quote;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += Math.min(2, source.length - index);
          continue;
        }
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      output += " ";
      continue;
    }
    if ((character === "-" && next === "-") || character === "#") {
      const newline = source.indexOf("\n", index + 1);
      index = newline < 0 ? source.length : newline;
      output += " ";
      continue;
    }
    output += character;
    index += 1;
  }
  return output.trim();
}

function shouldBlockUnsafeSql(command = "") {
  const normalizedSql = stripSqlCommentsAndStrings(command).toLowerCase();
  if (!normalizedSql) return false;
  const compactSql = normalizedSql.replace(/\s+/g, " ");
  const isUpdate = compactSql.startsWith("update ");
  const isDelete = compactSql.startsWith("delete ");
  const isSelectQuery = compactSql.startsWith("select ") && /\bfrom\b/.test(compactSql);
  if (!isUpdate && !isDelete && !isSelectQuery) return false;
  return !/\bwhere\b/.test(compactSql);
}

export async function executeSafeDatabaseCommand({ command = "", execute } = {}) {
  if (shouldBlockUnsafeSql(command)) {
    return {
      ok: false,
      code: 400,
      stdout: "",
      stderr: "unsafe sql blocked: SELECT/UPDATE/DELETE must include WHERE condition",
    };
  }
  return execute(command);
}

export {
  executeMysqlCommand,
  executePostgresCommand,
  executeSqliteCommand,
  releaseMysqlConnection,
  releasePostgresConnection,
  releaseSqliteConnection,
};
