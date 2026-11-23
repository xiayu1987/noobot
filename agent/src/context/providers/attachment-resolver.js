/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_SOURCE,
  assertAttachmentIngestResult,
  readRequiredAttachmentMetadata,
} from "@noobot/attachment-protocol";
import { projectCanonicalAttachmentIdentity } from "../../artifacts/index.js";
import { isFunction } from "@noobot/shared/value";

export async function resolveAttachments({
  attachmentService,
  userMessageAttachments = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!isFunction(attachmentService?.ingest)) {
    throw new TypeError("resolveAttachments requires attachmentService.ingest");
  }
  if (!Array.isArray(userMessageAttachments))
    throw new TypeError("userMessageAttachments must be an array");
  const sourceAttachments = userMessageAttachments;
  if (!sourceAttachments.length) return [];
  const identities = [];
  const rawAttachments = [];
  const selections = sourceAttachments.map((item) => {
    if (typeof item?.contentBase64 === "string") {
      return { index: rawAttachments.push(item) - 1, isUpload: true };
    }
    const identity = projectCanonicalAttachmentIdentity(item, sessionId);
    return { index: identities.push(identity) - 1, isUpload: false };
  });
  const records = await readRequiredAttachmentMetadata(attachmentService, { userId, identities });
  const ingested = rawAttachments.length
    ? await attachmentService.ingest({
        userId,
        sessionId,
        attachmentSource: ATTACHMENT_SOURCE.USER,
        attachments: rawAttachments,
      })
    : [];
  assertAttachmentIngestResult(rawAttachments, ingested);
  for (const record of ingested) projectCanonicalAttachmentIdentity(record, sessionId);
  return selections.map(({ index, isUpload }) => (isUpload ? ingested[index] : records[index]));
}
