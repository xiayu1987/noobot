/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizeConnectionSource(connectionInfo = {}) {
  return connectionInfo && typeof connectionInfo === "object" ? connectionInfo : {};
}

export function resolveDatabaseConnection({ source = {}, defaultPort = 0 } = {}) {
  return {
    host: String(source.host || "").trim(),
    port: Number(source.port || defaultPort),
    user: String(source.username || "").trim(),
    password: String(source.password || ""),
    database: String(source.database || "").trim(),
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
