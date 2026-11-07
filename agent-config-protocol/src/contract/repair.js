/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { CONFIG_DOCUMENT_SCOPE } from "./scope.js";

export const CONFIG_NODE_POLICY = Object.freeze({
  USER_CONFIGURABLE: "user_configurable",
  USER_OPTIONAL: "user_optional",
  GLOBAL_ONLY: "global_only",
});

export const CONFIG_ITEM_TYPE = Object.freeze({
  BUILTIN: "builtin",
  EXPLICIT: "explicit",
});

export const CONFIG_NODE_ACCESS = Object.freeze({
  USER: "user",
  SYSTEM: "system",
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
  RESET_TO_DEFAULT: "reset_to_default",
});

export const USER_CONFIG_MERGE_MODE = Object.freeze({
  defaultProvider: "replace",
  scenarios: "scenarios",
});

export const CONFIG_REPAIR_RULES = Object.freeze({
  missing_defaulted_node: Object.freeze([CONFIG_REPAIR_ACTION.ADD_DEFAULT]),
  outdated_protocol: Object.freeze([CONFIG_REPAIR_ACTION.MIGRATE_PROTOCOL]),
  scope_forbidden: Object.freeze([CONFIG_REPAIR_ACTION.REMOVE_SCOPE_FORBIDDEN]),
  unsupported_node: Object.freeze([CONFIG_REPAIR_ACTION.REMOVE_UNSUPPORTED]),
  invalid_option_value: Object.freeze([CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT]),
  ...Object.fromEntries(
    ["invalid_node_value", "invalid_node_type", "invalid_array_item"].map((reason) => [
      reason,
      Object.freeze([
        CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
        CONFIG_REPAIR_ACTION.REMOVE_INVALID_OPTIONAL,
      ]),
    ]),
  ),
});

export function requireConfigRepairRule(action, reason) {
  if (!CONFIG_REPAIR_RULES[reason]?.includes(action)) {
    throw new TypeError(`undeclared config repair: ${reason}/${action}`);
  }
}

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
