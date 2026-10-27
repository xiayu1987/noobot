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
import { text } from "@noobot/shared/value";

function draftClientAttachmentId(attachmentItem = {}) {
  if (text(attachmentItem?.attachmentId)) return "";
  return text(attachmentItem?.clientAttachmentId);
}

export function isDraftAttachmentItem(attachmentItem = {}) {
  return Boolean(draftClientAttachmentId(attachmentItem));
}

export function draftAttachmentDisplayKey(attachmentItem = {}) {
  const clientAttachmentId = draftClientAttachmentId(attachmentItem);
  if (!clientAttachmentId) {
    throw new TypeError("draft attachment missing clientAttachmentId");
  }
  return `draft:${clientAttachmentId}`;
}

export function resolveAttachmentDisplayKey(attachmentItem = {}) {
  if (isDraftAttachmentItem(attachmentItem)) return draftAttachmentDisplayKey(attachmentItem);
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

export function resolveParsedResultRelation(attachmentItem) {
  if (isDraftAttachmentItem(attachmentItem)) return null;
  const sourceIdentity = projectAttachmentIdentity(attachmentItem);
  return findAttachmentRelation(attachmentItem.relations, {
    relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
    sourceIdentity,
  });
}

export function resolveParsedResultAccessMeta(attachmentItem, { userId }) {
  const relation = resolveParsedResultRelation(attachmentItem);
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

export function buildParsedResultPreviewItem(attachmentItem) {
  const relation = resolveParsedResultRelation(attachmentItem);
  if (!relation) return null;
  return {
    attachmentId: relation.targetIdentity.attachmentId,
    sessionId: relation.targetIdentity.sessionId,
    attachmentSource: relation.targetIdentity.attachmentSource,
    name: relation.name || "",
    mimeType: relation.mimeType || "",
    ...(relation.size == null ? {} : { size: relation.size }),
  };
}
