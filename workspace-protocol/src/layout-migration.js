/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT, resolvePluginDataRelativePath } from "./layout.js";

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

export const WORKSPACE_LAYOUT_MIGRATION_ACTION = Object.freeze({
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
  if (typeof exists !== "function") throw new TypeError("exists(relativePath) is required");
  const actions = [];
  for (const migration of WORKSPACE_LAYOUT_MIGRATIONS) {
    if (!exists(migration.from)) continue;
    if (exists(migration.to)) throw conflictError(migration);
    actions.push(Object.freeze({ ...migration, action: WORKSPACE_LAYOUT_MIGRATION_ACTION.MOVE }));
  }
  return Object.freeze(actions);
}
