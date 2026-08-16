/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "./attachment-identity.js";
import {
  assertKnownFields,
  freezeDefined,
  isPlainObject,
  optionalBoolean,
  optionalNonEmptyString,
  optionalNonNegativeInteger,
  requireNonEmptyString,
  requirePlainObject,
} from "./protocol-utils.js";

const DESCRIPTOR_FIELDS = new Set([
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
const PERSISTED_FIELDS = new Set([
  "identity",
  "descriptor",
  "storageRef",
  "parsedResultRef",
  "createdAt",
  "updatedAt",
]);
const STORAGE_REF_FIELDS = new Set(["kind", "ref"]);
const PARSED_RESULT_REF_FIELDS = new Set([
  "identity",
  "name",
  "mimeType",
  "size",
  "storageRef",
  "tool",
  "updatedAt",
]);
const ACCESS_REF_FIELDS = new Set(["identity", "capability", "href"]);
const RUNTIME_REF_FIELDS = new Set(["identity", "turnScopeId", "dialogProcessId", "runId"]);
const UI_VIEW_FIELDS = new Set([
  "identity",
  "name",
  "mimeType",
  "size",
  "downloadAccess",
  "previewAccess",
  "parsedResultAccess",
]);

function parseStorageRef(value) {
  const source = requirePlainObject(value, "invalid_attachment_storage_ref");
  assertKnownFields(source, STORAGE_REF_FIELDS, "unknown_attachment_storage_ref_field");
  return freezeDefined({
    kind: requireNonEmptyString(source.kind, "invalid_attachment_storage_ref_kind"),
    ref: requireNonEmptyString(source.ref, "invalid_attachment_storage_ref_value"),
  });
}

function parseOwner(value) {
  if (value === undefined) return undefined;
  const source = requirePlainObject(value, "invalid_attachment_owner");
  assertKnownFields(source, new Set(["type", "id"]), "unknown_attachment_owner_field");
  return freezeDefined({
    type: optionalNonEmptyString(source.type, "invalid_attachment_owner_type"),
    id: optionalNonEmptyString(source.id, "invalid_attachment_owner_id"),
  });
}

function parseParsedResultRef(value) {
  if (value === undefined) return undefined;
  const source = requirePlainObject(value, "invalid_attachment_parsed_result_ref");
  assertKnownFields(source, PARSED_RESULT_REF_FIELDS, "unknown_attachment_parsed_result_ref_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(source.identity),
    name: optionalNonEmptyString(source.name, "invalid_attachment_parsed_result_name"),
    mimeType: optionalNonEmptyString(source.mimeType, "invalid_attachment_parsed_result_mime_type"),
    size: optionalNonNegativeInteger(source.size, "invalid_attachment_parsed_result_size"),
    storageRef: source.storageRef === undefined ? undefined : parseStorageRef(source.storageRef),
    tool: optionalNonEmptyString(source.tool, "invalid_attachment_parsed_result_tool"),
    updatedAt: optionalNonEmptyString(
      source.updatedAt,
      "invalid_attachment_parsed_result_updated_at",
    ),
  });
}

export function parseAttachmentDescriptor(value) {
  const source = requirePlainObject(value, "invalid_attachment_descriptor");
  assertKnownFields(source, DESCRIPTOR_FIELDS, "unknown_attachment_descriptor_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(source.identity),
    clientAttachmentId: optionalNonEmptyString(
      source.clientAttachmentId,
      "invalid_client_attachment_id",
    ),
    name: requireNonEmptyString(source.name, "invalid_attachment_name"),
    mimeType: requireNonEmptyString(source.mimeType, "invalid_attachment_mime_type"),
    size: optionalNonNegativeInteger(source.size, "invalid_attachment_size"),
    contentSha256: optionalNonEmptyString(
      source.contentSha256,
      "invalid_attachment_content_sha256",
    ),
    owner: parseOwner(source.owner),
    generationSource: optionalNonEmptyString(
      source.generationSource,
      "invalid_attachment_generation_source",
    ),
    generatedByModel: optionalBoolean(
      source.generatedByModel,
      "invalid_attachment_generated_by_model",
    ),
  });
}

export function parsePersistedAttachmentRecord(value) {
  const source = requirePlainObject(value, "invalid_persisted_attachment_record");
  assertKnownFields(source, PERSISTED_FIELDS, "unknown_persisted_attachment_record_field");
  const identity = parseAttachmentIdentity(source.identity);
  const descriptor = parseAttachmentDescriptor(source.descriptor);
  if (
    identity.attachmentId !== descriptor.identity.attachmentId ||
    identity.sessionId !== descriptor.identity.sessionId ||
    identity.attachmentSource !== descriptor.identity.attachmentSource
  ) {
    throw new Error("persisted_attachment_identity_mismatch");
  }
  return freezeDefined({
    identity,
    descriptor,
    storageRef: parseStorageRef(source.storageRef),
    parsedResultRef: parseParsedResultRef(source.parsedResultRef),
    createdAt: requireNonEmptyString(source.createdAt, "invalid_attachment_created_at"),
    updatedAt: requireNonEmptyString(source.updatedAt, "invalid_attachment_updated_at"),
  });
}

export function parseAttachmentAccessRef(value) {
  const source = requirePlainObject(value, "invalid_attachment_access_ref");
  assertKnownFields(source, ACCESS_REF_FIELDS, "unknown_attachment_access_ref_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(source.identity),
    capability: requireNonEmptyString(source.capability, "invalid_attachment_access_capability"),
    href: requireNonEmptyString(source.href, "invalid_attachment_access_href"),
  });
}

export function parseRuntimeAttachmentRef(value) {
  const source = requirePlainObject(value, "invalid_runtime_attachment_ref");
  assertKnownFields(source, RUNTIME_REF_FIELDS, "unknown_runtime_attachment_ref_field");
  return freezeDefined({
    identity: parseAttachmentIdentity(source.identity),
    turnScopeId: optionalNonEmptyString(source.turnScopeId, "invalid_attachment_turn_scope_id"),
    dialogProcessId: optionalNonEmptyString(
      source.dialogProcessId,
      "invalid_attachment_dialog_process_id",
    ),
    runId: optionalNonEmptyString(source.runId, "invalid_attachment_run_id"),
  });
}

export function parseAttachmentUiView(value) {
  const source = requirePlainObject(value, "invalid_attachment_ui_view");
  assertKnownFields(source, UI_VIEW_FIELDS, "unknown_attachment_ui_view_field");
  const parseOptionalAccess = (access) =>
    access === undefined ? undefined : parseAttachmentAccessRef(access);
  return freezeDefined({
    identity: parseAttachmentIdentity(source.identity),
    name: requireNonEmptyString(source.name, "invalid_attachment_ui_name"),
    mimeType: requireNonEmptyString(source.mimeType, "invalid_attachment_ui_mime_type"),
    size: optionalNonNegativeInteger(source.size, "invalid_attachment_ui_size"),
    downloadAccess: parseOptionalAccess(source.downloadAccess),
    previewAccess: parseOptionalAccess(source.previewAccess),
    parsedResultAccess: parseOptionalAccess(source.parsedResultAccess),
  });
}

export function assertAccessRefBelongsToAttachment(accessRef, identity) {
  const access = parseAttachmentAccessRef(accessRef);
  const expected = parseAttachmentIdentity(identity);
  if (
    access.identity.attachmentId !== expected.attachmentId ||
    access.identity.sessionId !== expected.sessionId ||
    access.identity.attachmentSource !== expected.attachmentSource
  ) {
    throw new Error("attachment_access_identity_mismatch");
  }
  return access;
}

export function isAttachmentModel(value) {
  return isPlainObject(value) && isPlainObject(value.identity);
}
