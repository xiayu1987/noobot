/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ATTACHMENT_RELATION_TYPE,
  parseAttachmentIdentity,
  parseAttachmentRelation,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { safeStr } from "../../shared/utils/shared-utils.js";
import { readAttachIndex, withAttachIndexLock, writeAttachIndex } from "../index-manager.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

export async function linkParsedResultToAttachment(
  service,
  { userId, sourceIdentity, targetAttachment, producerId = "" } = {},
) {
  if (!userId) throw new Error("invalid_attachment_relation_request");
  const normalizedSourceIdentity = parseAttachmentIdentity(sourceIdentity);
  const targetIdentity = projectAttachmentIdentity(targetAttachment);

  const basePath = resolveBasePath(service.globalConfig, userId);
  const updatedRecord = await linkParsedResultInScopes({
    basePath,
    sourceIdentity: normalizedSourceIdentity,
    targetAttachment,
    targetIdentity,
    producerId,
  });

  if (!updatedRecord) throw new Error("attachment_relation_source_not_found");
  return updatedRecord;
}

export async function linkParsedResultInScopes({
  basePath = "",
  sourceIdentity,
  targetAttachment,
  targetIdentity,
  producerId = "",
} = {}) {
  const normalizedSourceIdentity = parseAttachmentIdentity(sourceIdentity);
  const normalizedTargetIdentity = targetIdentity
    ? parseAttachmentIdentity(targetIdentity)
    : projectAttachmentIdentity(targetAttachment);
  const scope = {
    sessionId: normalizedSourceIdentity.sessionId,
    attachmentSource: normalizedSourceIdentity.attachmentSource,
  };
  return withAttachIndexLock(basePath, scope, async () => {
    const index = await readAttachIndex(basePath, scope);
    const sourceRecord = index?.attachments?.[normalizedSourceIdentity.attachmentId];
    if (!sourceRecord) return null;
    const relation = parseAttachmentRelation({
      relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
      sourceIdentity: normalizedSourceIdentity,
      targetIdentity: normalizedTargetIdentity,
      ...(safeStr(targetAttachment?.name) ? { name: safeStr(targetAttachment.name) } : {}),
      ...(safeStr(targetAttachment?.mimeType)
        ? { mimeType: safeStr(targetAttachment.mimeType) }
        : {}),
      ...(Number.isSafeInteger(Number(targetAttachment?.size))
        ? { size: Number(targetAttachment.size) }
        : {}),
      ...(safeStr(producerId) ? { producer: { type: "tool", id: safeStr(producerId) } } : {}),
      createdAt: new Date().toISOString(),
    });
    const nextRecord = { ...sourceRecord, relations: [relation] };
    index.attachments[normalizedSourceIdentity.attachmentId] = {
      ...sourceRecord,
      relations: nextRecord.relations,
    };
    await writeAttachIndex(basePath, index, scope);
    return buildPublicRecord(basePath, nextRecord);
  });
}
