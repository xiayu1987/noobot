/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  ATTACHMENT_RELATION_TYPE,
  parseAttachmentDescriptor,
  parseAttachmentIdentity,
  parseAttachmentRelation,
} from "@noobot/attachment-protocol";
import { readAttachIndex, withAttachIndexLock, writeAttachIndex } from "../index-manager.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

export async function linkParsedResultToAttachment(
  service,
  { userId, sourceIdentity, targetDescriptor, producerId } = {},
) {
  if (!userId) throw new Error("invalid_attachment_relation_request");
  const updatedRecord = await linkParsedResultInScopes({
    basePath: resolveBasePath(service.globalConfig, userId),
    sourceIdentity: parseAttachmentIdentity(sourceIdentity),
    target: parseAttachmentDescriptor(targetDescriptor),
    producerId,
  });
  if (!updatedRecord) throw new Error("attachment_relation_source_not_found");
  return updatedRecord;
}

async function linkParsedResultInScopes({ basePath, sourceIdentity, target, producerId }) {
  const scope = {
    sessionId: sourceIdentity.sessionId,
    attachmentSource: sourceIdentity.attachmentSource,
  };
  return withAttachIndexLock(basePath, scope, async () => {
    const index = await readAttachIndex(basePath, scope);
    const sourceRecord = index?.attachments?.[sourceIdentity.attachmentId];
    if (!sourceRecord) return null;
    const relation = parseAttachmentRelation({
      relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
      sourceIdentity,
      targetIdentity: target.identity,
      name: target.name,
      mimeType: target.mimeType,
      size: target.size,
      producer: { type: "tool", id: producerId },
      createdAt: new Date().toISOString(),
    });
    const nextRecord = { ...sourceRecord, relations: [relation] };
    index.attachments[sourceIdentity.attachmentId] = nextRecord;
    await writeAttachIndex(basePath, index, scope);
    return buildPublicRecord(basePath, nextRecord);
  });
}
