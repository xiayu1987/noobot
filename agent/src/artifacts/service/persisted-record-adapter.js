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
import { filePath as path } from "@noobot/path-resolver";
import { safeNum, safeStr } from "../../shared/utils/shared-utils.js";
import { DEFAULT_MIME_TYPE } from "../constants.js";

function identityFor(record, scope) {
  return {
    attachmentId: safeStr(record?.attachmentId),
    sessionId: safeStr(record?.sessionId || scope?.sessionId),
    attachmentSource: safeStr(record?.attachmentSource || scope?.attachmentSource),
  };
}

function storageRef(basePath, value) {
  const absolute = safeStr(value);
  if (!absolute) return "";
  return path.relative(basePath, absolute).split(path.sep).join("/");
}

function resolveStoragePath(basePath, ref) {
  const normalized = safeStr(ref);
  return normalized ? path.resolve(basePath, normalized) : "";
}

export function toPersistedAttachmentRecord(basePath, record, scope) {
  const identity = identityFor(record, scope);
  const now = new Date().toISOString();
  const createdAt = safeStr(record?.createdAt) || now;
  const updatedAt = safeStr(record?.updatedAt || record?.createdAt) || createdAt;
  const ref = storageRef(basePath, record?.path || record?.relativePath);
  if (!ref) return null;
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
      ...(record?.owner && typeof record.owner === "object" && !Array.isArray(record.owner)
        ? { owner: record.owner }
        : {}),
      ...(Number.isSafeInteger(Number(record?.size)) ? { size: Number(record.size) } : {}),
      ...(safeStr(record?.contentSha256) ? { contentSha256: safeStr(record.contentSha256) } : {}),
      ...(safeStr(record?.generationSource)
        ? { generationSource: safeStr(record.generationSource) }
        : {}),
      ...(record?.generatedByModel === true ? { generatedByModel: true } : {}),
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
  const output = {
    attachmentId: identity.attachmentId,
    ...(descriptor.clientAttachmentId ? { clientAttachmentId: descriptor.clientAttachmentId } : {}),
    ...(descriptor.contentSha256 ? { contentSha256: descriptor.contentSha256 } : {}),
    ...(descriptor.owner ? { owner: descriptor.owner } : {}),
    name: descriptor.name,
    mimeType: descriptor.mimeType,
    ...(descriptor.size === undefined ? {} : { size: descriptor.size }),
    path: resolveStoragePath(basePath, record.storageRef.ref),
    relativePath: record.storageRef.ref,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sessionId: identity.sessionId,
    attachmentSource: identity.attachmentSource,
    generatedByModel: descriptor.generatedByModel === true,
    generationSource: descriptor.generationSource || "",
    relations: record.relations,
  };
  return output;
}
