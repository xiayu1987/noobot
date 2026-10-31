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
  SESSION_TRANSFER_ENVELOPE: "session-transfer-envelope",
  MODEL_CONTEXT_SNAPSHOT: "model-context-snapshot",
  SESSION_MESSAGE_IDENTITY: "session-message-identity",
  EXECUTION_EVENT_INDEX: "execution-event-index",
  SESSION_TASK_ARTIFACT: "session-task-artifact",
  SESSION_MUTATION_REFS: "session-mutation-refs",
  SESSION_ACTIVITY_TIMELINE: "session-activity-timeline",
  SESSION_TOOL_RESULT: "session-tool-result",
  SESSION_SCRIPT_EXIT_CODE: "session-script-exit-code",
  SESSION_LEGACY_MCP_RESULT: "session-legacy-mcp-result",
  SESSION_RESULT_OVERFLOW: "session-result-overflow",
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
  Object.freeze({
    id: "session-tree-caller-v5",
    toVersion: 5,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_STORAGE,
  }),
  Object.freeze({
    id: "session-transfer-envelope-v6",
    toVersion: 6,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TRANSFER_ENVELOPE,
  }),
  Object.freeze({
    id: "model-context-snapshot-v7",
    toVersion: 7,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
  }),
  Object.freeze({
    id: "model-context-snapshot-v8",
    toVersion: 8,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
  }),
  Object.freeze({
    id: "session-message-identity-v9",
    toVersion: 9,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-lifecycle-records-retired-v10",
    toVersion: 10,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LIFECYCLE,
  }),
  Object.freeze({
    id: "session-orphan-tool-calls-v11",
    toVersion: 11,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-turn-terminal-description-v12",
    toVersion: 12,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-message-error-text-v13",
    toVersion: 13,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-turn-timing-lifecycle-start-v14",
    toVersion: 14,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-message-entity-contract-v15",
    toVersion: 15,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "session-retired-task-fields-v16",
    toVersion: 16,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MESSAGE_IDENTITY,
  }),
  Object.freeze({
    id: "execution-event-index-v3-v17",
    toVersion: 17,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.EXECUTION_EVENT_INDEX,
  }),
  Object.freeze({
    id: "session-task-artifact-retired-v18",
    toVersion: 18,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TASK_ARTIFACT,
  }),
  Object.freeze({
    id: "model-context-snapshot-v19",
    toVersion: 19,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.MODEL_CONTEXT_SNAPSHOT,
  }),
  Object.freeze({
    id: "session-mutation-refs-v20",
    toVersion: 20,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_MUTATION_REFS,
  }),
  Object.freeze({
    id: "session-activity-timeline-v21",
    toVersion: 21,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_ACTIVITY_TIMELINE,
  }),
  Object.freeze({
    id: "session-tool-result-v22",
    toVersion: 22,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_TOOL_RESULT,
  }),
  Object.freeze({
    id: "session-script-exit-code-v23",
    toVersion: 23,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_SCRIPT_EXIT_CODE,
  }),
  Object.freeze({
    id: "session-legacy-mcp-result-v24",
    toVersion: 24,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_LEGACY_MCP_RESULT,
  }),
  Object.freeze({
    id: "session-result-overflow-v25",
    toVersion: 25,
    owner: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_RESULT_OVERFLOW,
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
