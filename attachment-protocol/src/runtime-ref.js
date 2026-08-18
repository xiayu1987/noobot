/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "./identity.js";
import {
  assertKnownFields,
  freezeDefined,
  optionalNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set(["identity", "turnScopeId", "dialogProcessId", "runId"]);
export function parseRuntimeAttachmentRef(value) {
  const s = requirePlainObject(value, "invalid_runtime_attachment_ref");
  assertKnownFields(s, FIELDS, "unknown_runtime_attachment_ref_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(s.identity),
    turnScopeId: optionalNonEmptyString(s.turnScopeId, "invalid_attachment_turn_scope_id"),
    dialogProcessId: optionalNonEmptyString(
      s.dialogProcessId,
      "invalid_attachment_dialog_process_id",
    ),
    runId: optionalNonEmptyString(s.runId, "invalid_attachment_run_id"),
  });
}
