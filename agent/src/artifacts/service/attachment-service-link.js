/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_RELATION_TYPE,
  parseAttachmentRelation,
  readRequiredAttachmentMetadata,
  requireParsedAttachmentLink,
} from "@noobot/attachment-protocol";
import { withAttachmentSessionWrite } from "../index-manager.js";
import { resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

export function linkParsedResultToAttachment(service, request) {
  const { userId, sourceIdentity, targetIdentity, producerId } =
    requireParsedAttachmentLink(request);
  const basePath = resolveBasePath(service.globalConfig, userId);
  return withAttachmentSessionWrite(
    {
      basePath,
      userId,
      scope: sourceIdentity,
      referencedSessionIds: [targetIdentity.sessionId],
      prepare: () =>
        readRequiredAttachmentMetadata(service, {
          userId,
          identities: [sourceIdentity, targetIdentity],
        }),
    },
    (catalog, [source, target]) => {
      const relation = parseAttachmentRelation({
        relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
        sourceIdentity,
        targetIdentity,
        name: target.name,
        mimeType: target.mimeType,
        size: target.size,
        producer: { type: "tool", id: producerId },
        createdAt: new Date().toISOString(),
      });
      const updated = { ...source, relations: [relation], updatedAt: relation.createdAt };
      catalog.replace(updated);
      return buildPublicRecord(basePath, updated);
    },
  );
}
