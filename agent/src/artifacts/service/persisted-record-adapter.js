/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
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
  const parsed = record?.parsedResult && typeof record.parsedResult === "object"
    ? record.parsedResult
    : null;
  const ref = storageRef(basePath, record?.path || record?.relativePath);
  if (!ref) return null;
  const persisted = {
    identity,
    descriptor: {
      identity,
      ...(safeStr(record?.clientAttachmentId) ? { clientAttachmentId: safeStr(record.clientAttachmentId) } : {}),
      name: safeStr(record?.name),
      mimeType: safeStr(record?.mimeType, DEFAULT_MIME_TYPE),
      ...(record?.owner && typeof record.owner === "object" && !Array.isArray(record.owner)
        ? { owner: record.owner }
        : {}),
      ...(Number.isSafeInteger(Number(record?.size)) ? { size: Number(record.size) } : {}),
      ...(safeStr(record?.contentSha256) ? { contentSha256: safeStr(record.contentSha256) } : {}),
      ...(safeStr(record?.generationSource) ? { generationSource: safeStr(record.generationSource) } : {}),
      ...(record?.generatedByModel === true ? { generatedByModel: true } : {}),
    },
    storageRef: { kind: "attachment-store", ref },
    createdAt,
    updatedAt,
  };
  if (parsed && safeStr(parsed.attachmentId)) {
    const parsedIdentity = {
      attachmentId: safeStr(parsed.attachmentId),
      sessionId: safeStr(parsed.sessionId || identity.sessionId),
      attachmentSource: safeStr(parsed.attachmentSource || "parsed"),
    };
    persisted.parsedResultRef = {
      identity: parsedIdentity,
      ...(safeStr(parsed.name) ? { name: safeStr(parsed.name) } : {}),
      ...(safeStr(parsed.mimeType) ? { mimeType: safeStr(parsed.mimeType) } : {}),
      ...(Number.isSafeInteger(Number(parsed.size)) ? { size: Number(parsed.size) } : {}),
      ...(storageRef(basePath, parsed.path) ? {
        storageRef: { kind: "parsed-attachment-store", ref: storageRef(basePath, parsed.path) },
      } : {}),
      ...(safeStr(parsed.tool) ? { tool: safeStr(parsed.tool) } : {}),
      ...(safeStr(parsed.updatedAt) ? { updatedAt: safeStr(parsed.updatedAt) } : {}),
    };
  }
  return parsePersistedAttachmentRecord(persisted);
}

/**
 * Session/runtime display metadata is deliberately not part of the protocol
 * persisted record. Keep it in the index view projection instead.
 */
export function toAttachmentDisplayProjection(record = {}) {
  const projection = {};
  for (const field of [
    "sandboxPath",
    "downloadUrl",
    "previewUrl",
    "parsedResultUrl",
    "parsedResultName",
    "parsedResultAttachmentId",
    "transferFilePath",
  ]) {
    const value = safeStr(record?.[field]);
    if (value) projection[field] = value;
  }
  if (typeof record?.isSandbox === "boolean") projection.isSandbox = record.isSandbox;
  return projection;
}

export function applyAttachmentDisplayProjection(record, projection) {
  if (!record || !projection || typeof projection !== "object") return record;
  return { ...record, ...toAttachmentDisplayProjection(projection) };
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
  };
  if (record.parsedResultRef) {
    const parsed = record.parsedResultRef;
    output.parsedResult = {
      attachmentId: parsed.identity.attachmentId,
      sessionId: parsed.identity.sessionId,
      attachmentSource: parsed.identity.attachmentSource,
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.mimeType ? { mimeType: parsed.mimeType } : {}),
      ...(parsed.size === undefined ? {} : { size: parsed.size }),
      ...(parsed.storageRef ? { path: resolveStoragePath(basePath, parsed.storageRef.ref), relativePath: parsed.storageRef.ref } : {}),
      ...(parsed.tool ? { tool: parsed.tool } : {}),
      ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
    };
  }
  return output;
}
