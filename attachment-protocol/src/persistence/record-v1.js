/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentDescriptor } from "../descriptor.js";
import { AttachmentProtocolError } from "../errors.js";
import { parseAttachmentIdentity, sameAttachmentIdentity } from "../identity.js";
import { parseAttachmentRelation } from "../relation.js";
import { parseAttachmentStorageRef } from "../storage-ref.js";
import {
  assertKnownFields,
  freezeDefined,
  requireNonEmptyString,
  requirePlainObject,
} from "../protocol-utils.js";
export const ATTACHMENT_RECORD_SCHEMA = "noobot.attachment-record";
export const ATTACHMENT_RECORD_VERSION = 1;
const FIELDS = new Set([
  "schema",
  "version",
  "identity",
  "descriptor",
  "storageRef",
  "relations",
  "createdAt",
  "updatedAt",
]);
export function parsePersistedAttachmentRecordV1(value) {
  const s = requirePlainObject(value, "invalid_persisted_attachment_record");
  assertKnownFields(s, FIELDS, "unknown_persisted_attachment_record_field");
  if (s.schema !== ATTACHMENT_RECORD_SCHEMA)
    throw new AttachmentProtocolError("unsupported_attachment_record_schema");
  if (s.version !== ATTACHMENT_RECORD_VERSION)
    throw new AttachmentProtocolError("unsupported_attachment_record_version");
  const identity = parseAttachmentIdentity(s.identity),
    descriptor = parseAttachmentDescriptor(s.descriptor);
  if (!sameAttachmentIdentity(identity, descriptor.identity))
    throw new AttachmentProtocolError("persisted_attachment_identity_mismatch");
  const relations = s.relations === undefined ? [] : s.relations;
  if (!Array.isArray(relations)) {
    throw new AttachmentProtocolError("invalid_attachment_relations");
  }
  const parsedRelations = relations.map(parseAttachmentRelation);
  for (const relation of parsedRelations) {
    if (!sameAttachmentIdentity(identity, relation.sourceIdentity))
      throw new AttachmentProtocolError("attachment_relation_source_identity_mismatch");
  }
  return freezeDefined({
    schema: s.schema,
    version: s.version,
    identity,
    descriptor,
    storageRef: parseAttachmentStorageRef(s.storageRef),
    relations: Object.freeze(parsedRelations),
    createdAt: requireNonEmptyString(s.createdAt, "invalid_attachment_created_at"),
    updatedAt: requireNonEmptyString(s.updatedAt, "invalid_attachment_updated_at"),
  });
}
export const parsePersistedAttachmentRecord = parsePersistedAttachmentRecordV1;
