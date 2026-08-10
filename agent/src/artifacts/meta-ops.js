/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_ATTACHMENT_SESSION_ID, DEFAULT_ATTACHMENT_SOURCE, DEFAULT_MIME_TYPE } from "./constants.js";
import { safeStr, safeNum } from "../shared/utils/shared-utils.js";
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanPlainObject(value = {}) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || child === null) continue;
    if (typeof child === "string") {
      const normalized = safeStr(child);
      if (normalized) out[key] = normalized;
      continue;
    }
    if (isPlainObject(child)) {
      const nested = cleanPlainObject(child);
      if (nested) out[key] = nested;
      continue;
    }
    if (Array.isArray(child)) {
      if (child.length) out[key] = child;
      continue;
    }
    out[key] = child;
  }
  return Object.keys(out).length ? out : null;
}

function omitKeys(source = {}, keys = []) {
  const out = { ...(isPlainObject(source) ? source : {}) };
  for (const key of keys) delete out[key];
  return out;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function projectCanonicalAttachmentIdentity(attachmentItem = {}, expectedSessionId = "") {
  let identity;
  try {
    identity = projectAttachmentIdentity(attachmentItem);
  } catch (error) {
    error.statusCode ??= 400;
    error.errorCode ??= "INVALID_CANONICAL_ATTACHMENT";
    throw error;
  }
  const normalizedExpectedSessionId = safeStr(expectedSessionId);
  if (normalizedExpectedSessionId && identity.sessionId !== normalizedExpectedSessionId) {
    const error = new Error("attachment must be canonical and belong to the current session");
    error.statusCode = 400;
    error.errorCode = "INVALID_CANONICAL_ATTACHMENT";
    throw error;
  }
  return identity;
}

export function projectCanonicalAttachmentIdentities(attachments = [], expectedSessionId = "") {
  if (!Array.isArray(attachments)) {
    const error = new Error("attachments must be a canonical array");
    error.statusCode = 400;
    error.errorCode = "INVALID_CANONICAL_ATTACHMENT";
    throw error;
  }
  return attachments.map((attachmentItem) =>
    projectCanonicalAttachmentIdentity(attachmentItem, expectedSessionId));
}

export function canonicalAttachmentIdentityKey(attachmentItem = {}) {
  try {
    return attachmentIdentityKey(attachmentItem);
  } catch (error) {
    error.statusCode ??= 400;
    error.errorCode ??= "INVALID_CANONICAL_ATTACHMENT";
    throw error;
  }
}

export function assertCanonicalAttachments(attachments = [], expectedSessionId = "") {
  projectCanonicalAttachmentIdentities(attachments, expectedSessionId);
}

export function normalizeAttachmentOwnerMeta(attachmentItem = {}) {
  const explicitOwner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const baseOwner = cleanPlainObject(explicitOwner) || {};
  const type = safeStr(baseOwner.type);
  const id = safeStr(baseOwner.id);
  const normalized = {
    ...baseOwner,
    ...(type ? { type } : {}),
    ...(id ? { id } : {}),
  };
  return cleanPlainObject(normalized);
}

export function normalizeAttachmentTurnScopeMeta(attachmentItem = {}, normalizedOwner = null) {
  const owner = isPlainObject(normalizedOwner) ? normalizedOwner : normalizeAttachmentOwnerMeta(attachmentItem);
  const explicitTurnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : null;
  const ownerTurnScope = isPlainObject(owner?.turnScope) ? owner.turnScope : null;
  const baseTurnScope = cleanPlainObject(explicitTurnScope || ownerTurnScope) || {};
  const normalized = {
    ...omitKeys(baseTurnScope, ["dialog_process_id", "turn_scope_id", "session_id"]),
    turnScopeId: safeStr(firstValue(baseTurnScope.turnScopeId, baseTurnScope.turn_scope_id)),
    dialogProcessId: safeStr(firstValue(baseTurnScope.dialogProcessId, baseTurnScope.dialog_process_id)),
    sessionId: safeStr(firstValue(baseTurnScope.sessionId, baseTurnScope.session_id)),
  };
  return cleanPlainObject(normalized);
}

export function normalizeAttachmentParsedResultMeta(attachmentItem = {}) {
  const explicitParsedResult = isPlainObject(attachmentItem?.parsedResult)
    ? attachmentItem.parsedResult
    : null;
  const baseParsedResult = cleanPlainObject(explicitParsedResult) || {};
  const normalized = {
    ...omitKeys(baseParsedResult, [
      "id",
      "attachment_id",
      "file_id",
      "updated_at",
      "relative_path",
      "filePath",
      "file_path",
      "fileName",
      "filename",
      "type",
      "mime",
      "bytes",
      "sandboxEnabled",
      "sandbox_enabled",
    ]),
    attachmentId: safeStr(firstValue(
      baseParsedResult.attachmentId,
      baseParsedResult.attachment_id,
      baseParsedResult.id,
      baseParsedResult.fileId,
      baseParsedResult.file_id,
    )),
    name: safeStr(firstValue(baseParsedResult.name, baseParsedResult.fileName, baseParsedResult.filename)),
    mimeType: safeStr(firstValue(baseParsedResult.mimeType, baseParsedResult.type, baseParsedResult.mime)),
    ...(safeNum(firstValue(baseParsedResult.size, baseParsedResult.bytes)) > 0
      ? { size: safeNum(firstValue(baseParsedResult.size, baseParsedResult.bytes)) }
      : {}),
    path: safeStr(firstValue(baseParsedResult.path, baseParsedResult.filePath, baseParsedResult.file_path)),
    relativePath: safeStr(firstValue(baseParsedResult.relativePath, baseParsedResult.relative_path)),
    tool: safeStr(baseParsedResult.tool),
    updatedAt: safeStr(firstValue(baseParsedResult.updatedAt, baseParsedResult.updated_at)),
    ...(typeof baseParsedResult?.isSandbox === "boolean"
      ? { isSandbox: baseParsedResult.isSandbox }
      : typeof baseParsedResult?.sandboxEnabled === "boolean"
        ? { isSandbox: baseParsedResult.sandboxEnabled }
        : typeof baseParsedResult?.sandbox_enabled === "boolean"
          ? { isSandbox: baseParsedResult.sandbox_enabled }
          : {}),
  };
  return cleanPlainObject(normalized);
}

export function mergeAttachmentMetas(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!incomingList.length) return existingList;

  const merged = [...existingList];
  const idSet = new Set(
    existingList.map((item) => safeStr(item?.attachmentId)).filter(Boolean),
  );

  for (const item of incomingList) {
    const id = safeStr(item?.attachmentId);
    if (id && idSet.has(id)) continue;
    merged.push(item);
    if (id) idSet.add(id);
  }
  return merged;
}

export function attachmentMatchKeys(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  try {
    return [canonicalAttachmentIdentityKey({
      attachmentId: item.attachmentId,
      sessionId: item.sessionId,
      attachmentSource: item.attachmentSource,
    })];
  } catch {
    // Legacy records must be normalized by the single legacy adapter before
    // they enter a matching path. Access/content fields are never identity.
    return [];
  }
}

export function findMatchingAttachmentMeta(source = {}, candidates = []) {
  const sourceKeys = new Set(attachmentMatchKeys(source));
  if (!sourceKeys.size) return null;
  return (Array.isArray(candidates) ? candidates : []).find((candidate) =>
    attachmentMatchKeys(candidate).some((key) => sourceKeys.has(key)),
  ) || null;
}

export function hasAttachmentMetaValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return safeStr(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function mergeAttachmentMetaPreferRich(rich = {}, raw = {}) {
  const out = { ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) };
  for (const [key, value] of Object.entries(rich && typeof rich === "object" && !Array.isArray(rich) ? rich : {})) {
    if (hasAttachmentMetaValue(value)) out[key] = value;
  }
  return out;
}

export function mergeAttachmentListsPreferRich(existing = [], incoming = []) {
  if (!Array.isArray(incoming)) return undefined;
  if (incoming.length === 0) return [];
  const existingList = Array.isArray(existing) ? existing : [];
  return incoming.map((incomingItem) => {
    const match = findMatchingAttachmentMeta(incomingItem, existingList);
    return match ? mergeAttachmentMetaPreferRich(match, incomingItem) : incomingItem;
  });
}

export function normalizeAttachmentMetas(attachmentMetas = []) {
  const source = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  return source
    .map((attachmentItem) => {
      if (typeof attachmentItem === "string") {
        const pathStr = String(attachmentItem || "").trim();
        return pathStr ? { path: pathStr } : null;
      }
      if (!attachmentItem || typeof attachmentItem !== "object") return null;
      const normalized = {
        attachmentId: safeStr(firstValue(
          attachmentItem?.attachmentId,
          attachmentItem?.attachment_id,
          attachmentItem?.id,
          attachmentItem?.fileId,
          attachmentItem?.file_id,
        )),
        clientAttachmentId: safeStr(firstValue(
          attachmentItem?.clientAttachmentId,
          attachmentItem?.client_attachment_id,
        )),
        contentSha256: safeStr(firstValue(
          attachmentItem?.contentSha256,
          attachmentItem?.content_sha256,
        )),
        sessionId: safeStr(firstValue(
          attachmentItem?.sessionId,
          attachmentItem?.session_id,
        )),
        attachmentSource: safeStr(firstValue(
          attachmentItem?.attachmentSource,
          attachmentItem?.attachment_source,
        )),
        name: safeStr(firstValue(attachmentItem?.name, attachmentItem?.fileName, attachmentItem?.filename)),
        mimeType: safeStr(firstValue(attachmentItem?.mimeType, attachmentItem?.type, attachmentItem?.mime)),
        size: safeNum(firstValue(attachmentItem?.size, attachmentItem?.bytes)),
        path: safeStr(firstValue(attachmentItem?.path, attachmentItem?.filePath, attachmentItem?.file_path)),
        relativePath: safeStr(firstValue(attachmentItem?.relativePath, attachmentItem?.relative_path)),
        sandboxPath: safeStr(firstValue(
          attachmentItem?.sandboxPath,
          attachmentItem?.sandboxViewPath,
          attachmentItem?.sandbox_path,
          attachmentItem?.sandbox_view_path,
        )),
        generationSource: safeStr(firstValue(
          attachmentItem?.generationSource,
          attachmentItem?.generation_source,
        )),
        ...(typeof attachmentItem?.isSandbox === "boolean"
          ? { isSandbox: attachmentItem.isSandbox }
          : typeof attachmentItem?.sandboxEnabled === "boolean"
            ? { isSandbox: attachmentItem.sandboxEnabled }
            : typeof attachmentItem?.sandbox_enabled === "boolean"
              ? { isSandbox: attachmentItem.sandbox_enabled }
              : {}),
      };
      if (!normalized.attachmentId) delete normalized.attachmentId;
      if (!normalized.clientAttachmentId) delete normalized.clientAttachmentId;
      if (!normalized.contentSha256) delete normalized.contentSha256;
      if (!normalized.sessionId) delete normalized.sessionId;
      if (!normalized.attachmentSource) delete normalized.attachmentSource;
      if (!normalized.name) delete normalized.name;
      if (!normalized.mimeType) delete normalized.mimeType;
      if (!normalized.size) delete normalized.size;
      if (!normalized.path) delete normalized.path;
      if (!normalized.relativePath) delete normalized.relativePath;
      if (!normalized.sandboxPath) delete normalized.sandboxPath;
      if (!normalized.generationSource) delete normalized.generationSource;
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
}

export function mapAttachmentRecordsToMetas(
  records = [],
  { fallbackMimeType = DEFAULT_MIME_TYPE, fallbackGenerationSource = "" } = {},
) {
  const list = Array.isArray(records) ? records : [];
  return list.map((item) => {
    const owner = normalizeAttachmentOwnerMeta(item);
    const turnScope = normalizeAttachmentTurnScopeMeta(item, owner);
    const parsedResult = normalizeAttachmentParsedResultMeta(item);
    const canonicalMeta = normalizeAttachmentMetas([item])[0] || {};
    return {
      attachmentId: safeStr(canonicalMeta.attachmentId),
      ...(safeStr(canonicalMeta.clientAttachmentId) ? { clientAttachmentId: safeStr(canonicalMeta.clientAttachmentId) } : {}),
      ...(safeStr(canonicalMeta.contentSha256) ? { contentSha256: safeStr(canonicalMeta.contentSha256) } : {}),
      sessionId: safeStr(canonicalMeta.sessionId, DEFAULT_ATTACHMENT_SESSION_ID),
      attachmentSource: safeStr(canonicalMeta.attachmentSource, DEFAULT_ATTACHMENT_SOURCE),
      name: safeStr(canonicalMeta.name),
      mimeType: safeStr(canonicalMeta.mimeType, fallbackMimeType),
      size: safeNum(canonicalMeta.size),
      path: safeStr(canonicalMeta.path),
      relativePath: safeStr(canonicalMeta.relativePath),
      sandboxPath: safeStr(canonicalMeta.sandboxPath),
      downloadUrl: safeStr(item?.downloadUrl),
      previewUrl: safeStr(item?.previewUrl),
      parsedResultUrl: safeStr(item?.parsedResultUrl),
      parsedResultName: safeStr(item?.parsedResultName),
      parsedResultAttachmentId: safeStr(item?.parsedResultAttachmentId),
      transferFilePath: safeStr(item?.transferFilePath),
      generatedByModel: item?.generatedByModel === true,
      generationSource: safeStr(canonicalMeta.generationSource, fallbackGenerationSource),
      ...(typeof canonicalMeta?.isSandbox === "boolean" ? { isSandbox: canonicalMeta.isSandbox } : {}),
      ...(owner ? { owner } : {}),
      ...(turnScope ? { turnScope } : {}),
      ...(parsedResult ? { parsedResult } : {}),
    };
  });
}
