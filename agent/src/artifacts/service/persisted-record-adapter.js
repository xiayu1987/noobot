/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ATTACHMENT_RECORD_SCHEMA,
  ATTACHMENT_RECORD_VERSION,
  parsePersistedAttachmentRecord,
} from "@noobot/attachment-protocol";
import {
  filePath as path,
  isAbsolutePathAnyPlatform,
  isPathWithinRoot,
} from "@noobot/path-resolver";
import { isPlainObject } from "@noobot/shared/value";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { DEFAULT_MIME_TYPE } from "../constants.js";
import { attachScopeRoot } from "./attachment-storage-layout.js";

function identityFor(record) {
  return {
    attachmentId: safeStr(record.attachmentId),
    sessionId: safeStr(record.sessionId),
    attachmentSource: safeStr(record.attachmentSource),
  };
}

function assertScopedStoragePath(basePath, identity, candidate) {
  const scopeRoot = attachScopeRoot(basePath, identity);
  if (!isPathWithinRoot(scopeRoot, candidate)) {
    throw new Error("attachment_storage_ref_scope_mismatch");
  }
  return candidate;
}

function resolveRuntimeStoragePath(basePath, identity, value) {
  const source = safeStr(value);
  if (!source) throw new Error("attachment_storage_ref_required");
  const candidate = path.isAbsolute(source) ? path.resolve(source) : path.resolve(basePath, source);
  return assertScopedStoragePath(basePath, identity, candidate);
}

function resolvePersistedStorageRef(basePath, identity, value) {
  const ref = safeStr(value);
  if (!ref) throw new Error("attachment_storage_ref_required");
  if (ref.includes("\\") || isAbsolutePathAnyPlatform(ref)) {
    throw new Error("attachment_storage_ref_must_be_relative");
  }
  const candidate = path.resolve(basePath, ref);
  const canonicalRef = path.relative(basePath, candidate).split(path.sep).join("/");
  if (canonicalRef !== ref) throw new Error("attachment_storage_ref_not_canonical");
  return assertScopedStoragePath(basePath, identity, candidate);
}

function storageRef(basePath, identity, value) {
  return path
    .relative(basePath, resolveRuntimeStoragePath(basePath, identity, value))
    .split(path.sep)
    .join("/");
}

export function toPersistedAttachmentRecord(basePath, record) {
  const identity = identityFor(record);
  const createdAt = safeStr(record.createdAt);
  const updatedAt = safeStr(record.updatedAt);
  const storagePath = safeStr(record.path);
  if (!storagePath) return null;
  const ref = storageRef(basePath, identity, storagePath);
  const persisted = {
    schema: ATTACHMENT_RECORD_SCHEMA,
    version: ATTACHMENT_RECORD_VERSION,
    identity,
    descriptor: {
      identity,
      ...(safeStr(record?.clientAttachmentId)
        ? { clientAttachmentId: safeStr(record.clientAttachmentId) }
        : {}),
      name: safeStr(record?.name),
      mimeType: safeStr(record?.mimeType, DEFAULT_MIME_TYPE),
      ...(isPlainObject(record?.owner) ? { owner: record.owner } : {}),
      ...(Number.isSafeInteger(Number(record?.size)) ? { size: Number(record.size) } : {}),
      ...(safeStr(record?.contentSha256) ? { contentSha256: safeStr(record.contentSha256) } : {}),
      ...(safeStr(record?.generationSource)
        ? { generationSource: safeStr(record.generationSource) }
        : {}),
      ...(record?.generatedByModel === true ? { generatedByModel: true } : {}),
      ...(safeStr(record?.sourcePath) ? { sourcePath: safeStr(record.sourcePath) } : {}),
    },
    storageRef: { kind: "attachment-store", ref },
    relations: Array.isArray(record?.relations) ? record.relations : [],
    createdAt,
    updatedAt,
  };
  return parsePersistedAttachmentRecord(persisted);
}

export function fromPersistedAttachmentRecord(basePath, persisted) {
  const record = parsePersistedAttachmentRecord(persisted);
  const { identity, descriptor } = record;
  const storagePath = resolvePersistedStorageRef(basePath, identity, record.storageRef.ref);
  const output = {
    attachmentId: identity.attachmentId,
    ...(descriptor.clientAttachmentId ? { clientAttachmentId: descriptor.clientAttachmentId } : {}),
    ...(descriptor.contentSha256 ? { contentSha256: descriptor.contentSha256 } : {}),
    ...(descriptor.owner ? { owner: descriptor.owner } : {}),
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    ...(descriptor.size === undefined ? {} : { size: descriptor.size }),
    path: storagePath,
    relativePath: record.storageRef.ref,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sessionId: identity.sessionId,
    attachmentSource: identity.attachmentSource,
    generatedByModel: descriptor.generatedByModel === true,
    generationSource: descriptor.generationSource || "",
    ...(descriptor.sourcePath ? { sourcePath: descriptor.sourcePath } : {}),
    relations: record.relations,
  };
  return output;
}
