/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildAttachmentUrl } from "../chat/chatApi.js";
import {
  ATTACHMENT_RELATION_TYPE,
  attachmentIdentityKey,
  findAttachmentRelation,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function normalizedDraftAttachmentId(attachmentItem = {}) {
  if (String(attachmentItem?.attachmentId || "").trim()) return "";
  return String(
    attachmentItem?.clientAttachmentId || attachmentItem?.draftAttachmentId || "",
  ).trim();
}

export function isDraftAttachmentItem(attachmentItem = {}) {
  return Boolean(normalizedDraftAttachmentId(attachmentItem));
}

export function resolveAttachmentDisplayKey(attachmentItem = {}) {
  const draftAttachmentId = normalizedDraftAttachmentId(attachmentItem);
  if (draftAttachmentId) return `draft:${draftAttachmentId}`;
  return `canonical:${attachmentIdentityKey(projectAttachmentIdentity(attachmentItem))}`;
}

export function mergeAttachmentDisplayItems(...collections) {
  const merged = new Map();
  for (const attachmentItem of collections.flatMap((items) =>
    Array.isArray(items) ? items : [],
  )) {
    merged.set(resolveAttachmentDisplayKey(attachmentItem), attachmentItem);
  }
  return [...merged.values()];
}

function buildAccessUrl(identity, userId) {
  return buildAttachmentUrl({ userId, ...identity });
}

export function resolveAttachmentAccessMeta(attachmentItem = {}, { userId = "" } = {}) {
  const identity = projectAttachmentIdentity(attachmentItem);
  return {
    ...identity,
    url: buildAccessUrl(identity, userId),
  };
}

export function resolveParsedResultAccessMeta(attachmentItem = {}, { userId = "" } = {}) {
  if (isDraftAttachmentItem(attachmentItem)) return null;
  const sourceIdentity = projectAttachmentIdentity(attachmentItem);
  const relation = findAttachmentRelation(attachmentItem.relations, {
    relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
    sourceIdentity,
  });
  if (!relation) return null;
  return {
    relation,
    ...relation.targetIdentity,
    url: buildAccessUrl(relation.targetIdentity, userId),
    name: relation.name || "",
    mimeType: relation.mimeType || "",
    size: relation.size ?? null,
  };
}

export function buildParsedResultPreviewItem(attachmentItem = {}, options = {}) {
  const access = resolveParsedResultAccessMeta(attachmentItem, options);
  if (!access) return null;
  return {
    attachmentId: access.attachmentId,
    sessionId: access.sessionId,
    attachmentSource: access.attachmentSource,
    name: access.name,
    mimeType: access.mimeType,
    ...(access.size === null ? {} : { size: access.size }),
  };
}
