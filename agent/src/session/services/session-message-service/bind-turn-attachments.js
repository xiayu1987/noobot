/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { prepareAttachmentBinding } from "../../attachment-binding-request.js";
import { readImmutableTurnMutationSource } from "./immutable-turn-source.js";
import { requireImmutableAttachmentBindingResult } from "@noobot/session-protocol/immutable-storage-graph";

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
  return this.sessionRepo.withSessionMutation(
    identity.userId,
    identity.sessionId,
    async () => {
      await using reader = await this.sessionRepo.requireSessionReader(
        identity.userId,
        identity.sessionId,
        { persistenceContext },
      );
      const committed = await this.sessionRepo.commitChanges(identity.userId, identity.sessionId, {
        persistenceContext,
        expectedGeneration: reader.generation,
        operationId: randomUUID(),
        changes: {
          attachmentBinding: {
            ...identity,
            attachments: canonicalAttachments,
            expectedAggregateVersion: normalizedExpectedVersion,
          },
        },
        committedAt: this.now(),
      });
      await using current = await this.sessionRepo.requireSessionReader(
        identity.userId,
        identity.sessionId,
        { persistenceContext },
      );
      const source = await readImmutableTurnMutationSource(current, identity);
      const result = requireImmutableAttachmentBindingResult(committed.result.attachmentBinding);
      if (result.messageUid !== identity.messageUid)
        throw new TypeError("Attachment binding result message identity mismatch");
      const record = await current.readMessage(result.messageUid);
      if (
        !record ||
        record.message.turnScopeId !== identity.turnScopeId ||
        record.message.role !== "user"
      )
        throw new TypeError(
          "Committed attachment binding message is missing or belongs to another turn",
        );
      return {
        userMessage: record.message,
        attachments: record.message.attachments,
        aggregateVersion: result.aggregateVersion,
        deduplicated: result.deduplicated,
        session: source,
      };
    },
    { persistenceContext },
  );
}
