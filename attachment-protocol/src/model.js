/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export * from "./descriptor.js";
export * from "./storage-ref.js";
export * from "./relation.js";
export * from "./access-ref.js";
export * from "./runtime-ref.js";

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

const UI_VIEW_FIELDS = new Set([
  "identity",
  "name",
  "mimeType",
  "size",
  "downloadAccess",
  "previewAccess",
]);

export function parseAttachmentUiView(value) {
  const source = requirePlainObject(value, "invalid_attachment_ui_view");
  assertKnownFields(source, UI_VIEW_FIELDS, "unknown_attachment_ui_view_field");
  const identity = parseAttachmentIdentity(source.identity);
  const parseAccess = (accessRef) =>
    accessRef === undefined ? undefined : assertAccessRefBelongsToAttachment(accessRef, identity);
  return freezeDefined({
    identity,
    name: requireNonEmptyString(source.name, "invalid_attachment_ui_name"),
    mimeType: requireNonEmptyString(source.mimeType, "invalid_attachment_ui_mime_type"),
    size: optionalNonNegativeInteger(source.size, "invalid_attachment_ui_size"),
    downloadAccess: parseAccess(source.downloadAccess),
    previewAccess: parseAccess(source.previewAccess),
  });
}

export function isAttachmentModel(value) {
  return isPlainObject(value) && isPlainObject(value.identity);
}
