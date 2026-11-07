/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { CONFIG_DOCUMENT_SCOPE } from "./scope.js";
import { CONFIG_ERROR_CODE } from "./errors.js";

export const CONFIG_ISSUE_POLICY = Object.freeze({
  [CONFIG_ERROR_CODE.INVALID_DOCUMENT]: Object.freeze({ impact: "document", autoRepair: false }),
  [CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT]: Object.freeze({
    impact: "document",
    autoRepair: false,
  }),
  [CONFIG_ERROR_CODE.MODEL_REFERENCE_NOT_FOUND]: Object.freeze({
    impact: "operation",
    autoRepair: false,
  }),
  [CONFIG_ERROR_CODE.MODEL_REFERENCE_CAPABILITY_MISMATCH]: Object.freeze({
    impact: "operation",
    autoRepair: false,
  }),
  [CONFIG_ERROR_CODE.INVALID_TOOL_BINDING_CONFIG]: Object.freeze({
    impact: "operation",
    autoRepair: false,
  }),
  [CONFIG_ERROR_CODE.INVALID_MODEL_LIBRARY_CONFIG]: Object.freeze({
    impact: "document",
    autoRepair: false,
  }),
  [CONFIG_ERROR_CODE.INVALID_SECURITY_CONFIG]: Object.freeze({
    impact: "startup",
    autoRepair: false,
  }),
});

export function createConfigIssue(code, details = {}) {
  const policy = CONFIG_ISSUE_POLICY[code];
  if (!policy) throw new TypeError(`unclassified config issue: ${code}`);
  return Object.freeze({ ...details, code, ...policy });
}

export function configIssueBlocksStartup(issue, scope) {
  if (!Object.values(CONFIG_DOCUMENT_SCOPE).includes(scope)) {
    throw new TypeError(`unsupported config scope: ${scope}`);
  }
  if (!["startup", "document", "operation"].includes(issue.impact))
    throw new TypeError(`invalid config issue impact: ${issue.impact}`);
  return (
    issue.impact === "startup" ||
    (issue.impact === "document" && scope === CONFIG_DOCUMENT_SCOPE.GLOBAL)
  );
}
