/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set(["kind", "ref"]);
export function parseAttachmentStorageRef(value) {
  const s = requirePlainObject(value, "invalid_attachment_storage_ref");
  assertKnownFields(s, FIELDS, "unknown_attachment_storage_ref_field");
  return freezeDefined({
    kind: requireNonEmptyString(s.kind, "invalid_attachment_storage_ref_kind"),
    ref: requireNonEmptyString(s.ref, "invalid_attachment_storage_ref_value"),
  });
}
