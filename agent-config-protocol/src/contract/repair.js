/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONFIG_DOCUMENT_SCOPE = Object.freeze({
  GLOBAL: "global",
  USER_DEFAULT: "user_default",
  USER: "user",
});

export const CONFIG_NODE_POLICY = Object.freeze({
  USER_CONFIGURABLE: "user_configurable",
  USER_OPTIONAL: "user_optional",
  GLOBAL_ONLY: "global_only",
});

export const CONFIG_ITEM_TYPE = Object.freeze({
  BUILTIN: "builtin",
  EXPLICIT: "explicit",
});

export const CONFIG_PATH_REPRESENTATION = Object.freeze({
  PERSISTED: "persisted",
  RUNTIME: "runtime",
});

export const CONFIG_REPAIR_ACTION = Object.freeze({
  ADD_DEFAULT: "add_default",
  MIGRATE_PROTOCOL: "migrate_protocol",
  REMOVE_INVALID_OPTIONAL: "remove_invalid_optional",
  REMOVE_SCOPE_FORBIDDEN: "remove_scope_forbidden",
  REMOVE_UNSUPPORTED: "remove_unsupported",
  RESTORE_INVALID_DOCUMENT: "restore_invalid_document",
  RESET_TO_DEFAULT: "reset_to_default",
});

// Which top-level keys a user may override is a structural fact, answered by the
// scope declarations in the field/structure contract. This map only records HOW
// an overridable key merges; anything not listed merges deeply.
export const USER_CONFIG_MERGE_MODE = Object.freeze({
  defaultProvider: "replace",
  scenarios: "scenarios",
});

// Which path carries which policy is a structural fact. It is declared once in
// the field/structure contract and read back through
// `listConfigNodePathsByPolicy` there, never restated as a path list here.

export function summarizeConfigRepairReport(report = {}) {
  const actionCounts = {};
  const changes = Array.isArray(report?.changes) ? report.changes : [];
  for (const change of changes) {
    const action = String(change?.action || "unknown");
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  return Object.freeze({
    changed: report?.changed === true,
    changeCount: changes.length,
    actionCounts: Object.freeze(actionCounts),
  });
}
