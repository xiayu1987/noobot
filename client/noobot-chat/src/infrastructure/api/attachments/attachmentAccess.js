/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildAttachmentUrl } from "../chat/chatApi.js";
import {
  ATTACHMENT_RELATION_TYPE,
  findAttachmentRelation,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

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

export function resolveParsedResultAccessMeta(
  attachmentItem = {},
  { userId = "" } = {},
) {
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
