/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertAccessRefBelongsToAttachment } from "./access-ref.js";
import { parseAttachmentIdentity } from "./identity.js";
import {
  assertKnownFields,
  freezeDefined,
  isPlainObject,
  optionalNonNegativeInteger,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set([
  "identity",
  "name",
  "mimeType",
  "size",
  "downloadAccess",
  "previewAccess",
]);
export function parseAttachmentUiView(value) {
  const s = requirePlainObject(value, "invalid_attachment_ui_view");
  assertKnownFields(s, FIELDS, "unknown_attachment_ui_view_field");
  const identity = parseAttachmentIdentity(s.identity);
  const access = (x) =>
    x === undefined ? undefined : assertAccessRefBelongsToAttachment(x, identity);
  return freezeDefined({
    identity,
    name: requireNonEmptyString(s.name, "invalid_attachment_ui_name"),
    mimeType: requireNonEmptyString(s.mimeType, "invalid_attachment_ui_mime_type"),
    size: optionalNonNegativeInteger(s.size, "invalid_attachment_ui_size"),
    downloadAccess: access(s.downloadAccess),
    previewAccess: access(s.previewAccess),
  });
}
export function isAttachmentModel(value) {
  return isPlainObject(value) && isPlainObject(value.identity);
}
