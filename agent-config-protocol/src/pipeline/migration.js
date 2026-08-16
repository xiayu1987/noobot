/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function normalizeConfigMigrations(migrations = []) {
  return (Array.isArray(migrations) ? migrations : []).map((entry, index) => {
    const migrate = typeof entry === "function" ? entry : entry?.migrate;
    if (typeof migrate !== "function") throw new TypeError(`invalid config migration at index ${index}`);
    return Object.freeze({
      name: String((typeof entry === "function" ? entry.name : entry?.name) || "").trim() || `migration#${index + 1}`,
      migrate,
    });
  });
}

export async function applyConfigMigrations({ config = {}, migrations = [], context = {} } = {}) {
  let nextConfig = clone(config) || {};
  const appliedMigrations = [];
  for (const migration of normalizeConfigMigrations(migrations)) {
    const output = await migration.migrate({ config: nextConfig, context });
    if (output !== undefined) nextConfig = output;
    appliedMigrations.push(migration.name);
  }
  return { config: nextConfig, appliedMigrations };
}
