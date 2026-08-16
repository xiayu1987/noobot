/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity, sameAttachmentIdentity } from "./identity.js";
import { AttachmentProtocolError } from "./errors.js";
import { parseAttachmentStorageRef } from "./storage-ref.js";
import {
  assertKnownFields,
  freezeDefined,
  optionalNonEmptyString,
  optionalNonNegativeInteger,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";
export const ATTACHMENT_RELATION_TYPE = Object.freeze({ PARSED_RESULT: "parsed_result" });
const FIELDS = new Set([
  "relationType",
  "sourceIdentity",
  "targetIdentity",
  "name",
  "mimeType",
  "size",
  "storageRef",
  "producer",
  "createdAt",
]);
export function parseAttachmentRelation(value) {
  const s = requirePlainObject(value, "invalid_attachment_relation");
  assertKnownFields(s, FIELDS, "unknown_attachment_relation_field");
  const relationType = requireNonEmptyString(s.relationType, "invalid_attachment_relation_type");
  if (relationType !== ATTACHMENT_RELATION_TYPE.PARSED_RESULT)
    throw new AttachmentProtocolError("unsupported_attachment_relation_type");
  let producer;
  if (s.producer !== undefined) {
    const p = requirePlainObject(s.producer, "invalid_attachment_relation_producer");
    assertKnownFields(p, new Set(["type", "id"]), "unknown_attachment_relation_producer_field");
    producer = freezeDefined({
      type: requireNonEmptyString(p.type, "invalid_attachment_relation_producer_type"),
      id: requireNonEmptyString(p.id, "invalid_attachment_relation_producer_id"),
    });
  }
  return freezeDefined({
    relationType,
    sourceIdentity: parseAttachmentIdentity(s.sourceIdentity),
    targetIdentity: parseAttachmentIdentity(s.targetIdentity),
    name: optionalNonEmptyString(s.name, "invalid_attachment_relation_name"),
    mimeType: optionalNonEmptyString(s.mimeType, "invalid_attachment_relation_mime_type"),
    size: optionalNonNegativeInteger(s.size, "invalid_attachment_relation_size"),
    storageRef: s.storageRef === undefined ? undefined : parseAttachmentStorageRef(s.storageRef),
    producer,
    createdAt: requireNonEmptyString(s.createdAt, "invalid_attachment_relation_created_at"),
  });
}

export function parseAttachmentRelations(value = []) {
  if (!Array.isArray(value)) throw new AttachmentProtocolError("invalid_attachment_relations");
  return Object.freeze(value.map(parseAttachmentRelation));
}

export function findAttachmentRelation(value, { relationType, sourceIdentity } = {}) {
  const normalizedType = requireNonEmptyString(relationType, "invalid_attachment_relation_type");
  const normalizedSourceIdentity = parseAttachmentIdentity(sourceIdentity);
  return (
    parseAttachmentRelations(value).find(
      (relation) =>
        relation.relationType === normalizedType &&
        sameAttachmentIdentity(relation.sourceIdentity, normalizedSourceIdentity),
    ) || null
  );
}
