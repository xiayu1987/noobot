/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { prepareAttachmentBinding } from "../../attachment-binding-request.js";
import {
  requireAttachmentBindingResponse,
  requireAttachmentBindingResult,
} from "@noobot/session-protocol";

export async function bindTurnAttachments({
  userId,
  sessionId,
  turnScopeId,
  messageUid,
  attachments,
  expectedAggregateVersion,
  commandId,
  persistenceContext,
}) {
  const { identity, canonicalAttachments, normalizedExpectedVersion } = prepareAttachmentBinding({
    userId,
    sessionId,
    turnScopeId,
    messageUid,
    commandId,
    attachments,
    expectedAggregateVersion,
  });
  return this.sessionRepo.withSessionReader(
    identity.userId,
    identity.sessionId,
    async ({ reader, commitChanges, readCurrent }) => {
      const committed = await commitChanges(
        await reader.prepareRequest({
          operationId: randomUUID(),
          changes: {
            attachmentBinding: {
              ...identity,
              attachments: canonicalAttachments,
              expectedAggregateVersion: normalizedExpectedVersion,
            },
          },
          committedAt: this.now(),
        }),
      );
      const result = requireAttachmentBindingResult(committed.result.attachmentBinding);
      if (result.messageUid !== identity.messageUid)
        throw new TypeError("Attachment binding result message identity mismatch");
      const storedAttachments = await readCurrent((current) =>
        current.readAttachmentBindingTarget(identity),
      );
      return requireAttachmentBindingResponse({ ...result, attachments: storedAttachments });
    },
    { persistenceContext },
  );
}
