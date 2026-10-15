/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function normalizeConnectionSource(connectionInfo = {}) {
  return connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
}

export function resolveDatabaseConnection({ source = {}, defaultPort = 0 } = {}) {
  return {
    host: text(source.host),
    port: Number(source.port || defaultPort),
    user: text(source.username),
    password: String(source.password || ""),
    database: text(source.database),
  };
}

export async function importDefaultOrModule(moduleName = "") {
  try {
    const mod = await import(String(moduleName || ""));
    return mod?.default || mod;
  } catch {
    return null;
  }
}
