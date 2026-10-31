/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { commandOutput } from "../channel-result.js";

export function requireConnectionSource(connectionInfo) {
  if (!isPlainObject(connectionInfo)) {
    throw new TypeError("database connector connectionInfo must be an object");
  }
  return connectionInfo;
}

export function resolveDatabaseConnection({ source, defaultPort }) {
  return {
    host: text(source.host),
    port: source.port === undefined || source.port === "" ? defaultPort : Number(source.port),
    user: text(source.username),
    password: source.password === undefined ? "" : String(source.password),
    database: text(source.database),
  };
}

export function queryOutput(payload) {
  return commandOutput({ stdout: JSON.stringify(payload) });
}
