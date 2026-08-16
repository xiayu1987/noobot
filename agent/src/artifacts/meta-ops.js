/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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
  void normalizedOwner;
  const explicitTurnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : null;
  const baseTurnScope = cleanPlainObject(explicitTurnScope) || {};
  const normalized = {
    turnScopeId: safeStr(baseTurnScope.turnScopeId),
    dialogProcessId: safeStr(baseTurnScope.dialogProcessId),
    sessionId: safeStr(baseTurnScope.sessionId),
  };
  return cleanPlainObject(normalized);
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

export function normalizeAttachmentMetas(attachmentMetas = []) {
  if (!Array.isArray(attachmentMetas)) {
    throw new TypeError("attachments must be a canonical array");
  }
  return attachmentMetas
    .map((attachmentItem) => {
      const identity = projectCanonicalAttachmentIdentity(attachmentItem);
      const normalized = {
        ...identity,
        clientAttachmentId: safeStr(attachmentItem.clientAttachmentId),
        contentSha256: safeStr(attachmentItem.contentSha256),
        name: safeStr(attachmentItem.name),
        mimeType: safeStr(attachmentItem.mimeType),
        size: safeNum(attachmentItem.size),
        path: safeStr(attachmentItem.path),
        relativePath: safeStr(attachmentItem.relativePath),
        sandboxPath: safeStr(attachmentItem.sandboxPath),
        generationSource: safeStr(attachmentItem.generationSource),
        ...(typeof attachmentItem?.isSandbox === "boolean" ? { isSandbox: attachmentItem.isSandbox } : {}),
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
) {
  if (!Array.isArray(records)) throw new TypeError("attachment records must be an array");
  const list = records;
  return list.map((item) => {
    const owner = normalizeAttachmentOwnerMeta(item);
    const turnScope = normalizeAttachmentTurnScopeMeta(item, owner);
    const canonicalMeta = normalizeAttachmentMetas([item])[0] || {};
    return {
      attachmentId: safeStr(canonicalMeta.attachmentId),
      ...(safeStr(canonicalMeta.clientAttachmentId) ? { clientAttachmentId: safeStr(canonicalMeta.clientAttachmentId) } : {}),
      ...(safeStr(canonicalMeta.contentSha256) ? { contentSha256: safeStr(canonicalMeta.contentSha256) } : {}),
      sessionId: canonicalMeta.sessionId,
      attachmentSource: canonicalMeta.attachmentSource,
      name: safeStr(canonicalMeta.name),
      mimeType: safeStr(canonicalMeta.mimeType),
      size: safeNum(canonicalMeta.size),
      path: safeStr(canonicalMeta.path),
      relativePath: safeStr(canonicalMeta.relativePath),
      sandboxPath: safeStr(canonicalMeta.sandboxPath),
      downloadUrl: safeStr(item?.downloadUrl),
      previewUrl: safeStr(item?.previewUrl),
      transferFilePath: safeStr(item?.transferFilePath),
      generatedByModel: item?.generatedByModel === true,
      generationSource: safeStr(canonicalMeta.generationSource),
      ...(typeof canonicalMeta?.isSandbox === "boolean" ? { isSandbox: canonicalMeta.isSandbox } : {}),
      ...(owner ? { owner } : {}),
      ...(turnScope ? { turnScope } : {}),
      relations: Array.isArray(item?.relations) ? item.relations : [],
    };
  });
}
