/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "./identity.js";
import {
  assertKnownFields,
  freezeDefined,
  optionalBoolean,
  optionalNonEmptyString,
  optionalNonNegativeInteger,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
const FIELDS = new Set([
  "identity",
  "clientAttachmentId",
  "name",
  "mimeType",
  "size",
  "contentSha256",
  "owner",
  "generationSource",
  "generatedByModel",
]);
function parseOwner(value) {
  if (value === undefined) return undefined;
  const s = requirePlainObject(value, "invalid_attachment_owner");
  assertKnownFields(s, new Set(["type", "id"]), "unknown_attachment_owner_field");
  return freezeDefined({
    type: optionalNonEmptyString(s.type, "invalid_attachment_owner_type"),
    id: optionalNonEmptyString(s.id, "invalid_attachment_owner_id"),
  });
}
export function parseAttachmentDescriptor(value) {
  const s = requirePlainObject(value, "invalid_attachment_descriptor");
  assertKnownFields(s, FIELDS, "unknown_attachment_descriptor_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(s.identity),
    clientAttachmentId: optionalNonEmptyString(
      s.clientAttachmentId,
      "invalid_client_attachment_id",
    ),
    name: requireNonEmptyString(s.name, "invalid_attachment_name"),
    mimeType: requireNonEmptyString(s.mimeType, "invalid_attachment_mime_type"),
    size: optionalNonNegativeInteger(s.size, "invalid_attachment_size"),
    contentSha256: optionalNonEmptyString(s.contentSha256, "invalid_attachment_content_sha256"),
    owner: parseOwner(s.owner),
    generationSource: optionalNonEmptyString(
      s.generationSource,
      "invalid_attachment_generation_source",
    ),
    generatedByModel: optionalBoolean(s.generatedByModel, "invalid_attachment_generated_by_model"),
  });
}
