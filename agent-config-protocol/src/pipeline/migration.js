/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";

const RETIRED_CONFIG_PATHS = Object.freeze(
  [
    ["configParams"],
    ["attachments", "attachment_models"],
    ["session", "use_last_running_task_range"],
    ["session", "use_last_completed_task_range"],
    ["tools", "set_skill_task"],
    ["tools", "web_to_data"],
    ["tools", "doc_to_data"],
    ["tools", "media_to_data"],
    ["tools", "process_content_task"],
    ["tools", "execute_script", "sandbox_mode"],
    ["tools", "execute_script", "sandbox_provider"],
  ].map((segments) => Object.freeze(segments)),
);

function deletePath(root, segments) {
  let node = root;
  const parents = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isPlainObject(node)) return;
    parents.push({ node, key: segments[index] });
    node = node[segments[index]];
    if (!isPlainObject(node)) return;
  }
  delete node[segments[segments.length - 1]];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parent = parents[index];
    const child = parent.node[parent.key];
    if (!isPlainObject(child) || Object.keys(child).length > 0) break;
    delete parent.node[parent.key];
  }
}

export function migrateConfigFileToCurrentProtocol(config = {}) {
  if (!isPlainObject(config)) return config;
  const migrated = structuredClone(config);
  for (const segments of RETIRED_CONFIG_PATHS) deletePath(migrated, segments);
  // The current model protocol has one transport format. Normalize persisted
  // provider documents at the protocol boundary before runtime validation.
  if (isPlainObject(migrated.providers)) {
    for (const provider of Object.values(migrated.providers)) {
      if (isPlainObject(provider) && provider.format === "dashscope") {
        provider.format = "openai_compatible";
      }
    }
  }
  return migrated;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function normalizeConfigMigrations(migrations = []) {
  return (Array.isArray(migrations) ? migrations : []).map((entry, index) => {
    const migrate = typeof entry === "function" ? entry : entry?.migrate;
    if (typeof migrate !== "function")
      throw new TypeError(`invalid config migration at index ${index}`);
    return Object.freeze({
      name:
        String((typeof entry === "function" ? entry.name : entry?.name) || "").trim() ||
        `migration#${index + 1}`,
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
