/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  resolvePluginDataRelativePath,
} from "./layout.js";

export const WORKSPACE_LAYOUT_UNMARKED_VERSION = 1;

export const WORKSPACE_LAYOUT_UPGRADE_OWNER = Object.freeze({
  SESSION_STORAGE: "session-storage",
  SESSION_LIFECYCLE: "session-lifecycle",
});

export const WORKSPACE_LAYOUT_UPGRADES = Object.freeze([
  Object.freeze({
    id: "session-storage-v2",
    toVersion: 2,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_STORAGE,
  }),
  Object.freeze({
    id: "session-tree-parent-only-v3",
    toVersion: 3,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_STORAGE,
  }),
  Object.freeze({
    id: "session-deletion-tombstone-only-v4",
    toVersion: 4,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LIFECYCLE,
  }),
]);

function layoutStateError(message) {
  const error = new TypeError(message);
  error.code = "WORKSPACE_LAYOUT_STATE_INVALID";
  return error;
}

export function parseWorkspaceLayoutState(text) {
  let value;
  try {
    value = JSON.parse(String(text ?? ""));
  } catch {
    throw layoutStateError("workspace layout state is not valid JSON");
  }
  const version = value?.version;
  if (!Number.isInteger(version) || version < 1 || version > WORKSPACE_LAYOUT_VERSION) {
    throw layoutStateError(`workspace layout state version is unsupported: ${version}`);
  }
  return { version };
}

export function renderWorkspaceLayoutState({ version } = {}) {
  if (!Number.isInteger(version) || version < 1 || version > WORKSPACE_LAYOUT_VERSION) {
    throw layoutStateError(`workspace layout state version is unsupported: ${version}`);
  }
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

export function planWorkspaceLayoutUpgrades({ installedVersion } = {}) {
  if (!Number.isInteger(installedVersion)) {
    throw new TypeError("installedVersion must be an integer");
  }
  return WORKSPACE_LAYOUT_UPGRADES.filter((upgrade) => upgrade.toVersion > installedVersion);
}

export const WORKSPACE_LAYOUT_MIGRATIONS = Object.freeze([
  Object.freeze({
    id: "workflow-plugin-data",
    from: `${WORKSPACE_LAYOUT.RUNTIME_DIR}/workflow`,
    to: resolvePluginDataRelativePath("workflow"),
  }),
  Object.freeze({
    id: "harness-plugin-data",
    from: `${WORKSPACE_LAYOUT.RUNTIME_DIR}/harness`,
    to: resolvePluginDataRelativePath("harness"),
  }),
]);

const WORKSPACE_LAYOUT_MIGRATION_ACTION = Object.freeze({
  MOVE: "move",
});

function conflictError(migration) {
  const error = new Error(
    `workspace layout migration ${migration.id} conflict: both ${migration.from} and ${migration.to} exist`,
  );
  error.code = "WORKSPACE_LAYOUT_MIGRATION_CONFLICT";
  error.details = { ...migration };
  return error;
}

export function planWorkspaceLayoutMigrations({ exists } = {}) {
  if (!isFunction(exists)) throw new TypeError("exists(relativePath) is required");
  const actions = [];
  for (const migration of WORKSPACE_LAYOUT_MIGRATIONS) {
    if (!exists(migration.from)) continue;
    if (exists(migration.to)) throw conflictError(migration);
    actions.push(Object.freeze({ ...migration, action: WORKSPACE_LAYOUT_MIGRATION_ACTION.MOVE }));
  }
  return Object.freeze(actions);
}
