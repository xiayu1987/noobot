/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createMessageUid, createUserMessageId } from "@noobot/session-protocol/message-identity";
import { createMessageAnchorMatcher } from "./anchor-utils.js";
import {
  createMessageDeleteResponse,
  parseMessageDeleteRequest,
  parseTurnReplaceRequest,
  createTurnReplaceResponse,
} from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";
import { buildDisplayMessageSummary } from "../../session-summary-builders/message-summary-projection.js";

async function commitMutation({
  userId,
  sessionId,
  persistenceContext,
  createResponse,
  changeType,
  change,
}) {
  return this.sessionRepo.withSessionReader(
    userId,
    sessionId,
    async ({ reader, commitChanges, readCurrent }) => {
      const committed = await commitChanges(
        await reader.prepareRequest({
          operationId: randomUUID(),
          committedAt: this.now(),
          changes: { [changeType]: change },
        }),
      );
      const { receipt, deduplicated } = committed.result[changeType];
      const { source, generation } = await readCurrent(async (current) => ({
        source: await current.readMutationProjection(receipt.commandId),
        generation: current.generation,
      }));
      if (!source || !isDeepStrictEqual(source.receipt, receipt)) {
        throw Object.assign(
          new Error("Committed mutation is missing its command change evidence"),
          {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
          },
        );
      }
      const displayMessages =
        source.kind === "baseline"
          ? []
          : source.messages.map(({ message, ordinal }) => ({
              ...buildDisplayMessageSummary(message),
              sessionOrdinal: ordinal,
            }));
      return createResponse({
        deduplicated,
        sessionId,
        generation,
        projection: source,
        displayMessages,
      });
    },
    { persistenceContext },
  );
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeAnchoredCommandRequest({ userId, sessionId, anchor, commandId }) {
  if (!userId || !sessionId) throw badRequest("userId and sessionId are required");
  const matcher = createMessageAnchorMatcher(anchor);
  if (!matcher) throw badRequest("message anchor is required");
  const normalizedCommandId = text(commandId);
  if (!normalizedCommandId) throw badRequest("commandId is required");
  return { matcher, normalizedCommandId };
}

export async function deleteFromMessage({
  userId,
  sessionId,
  persistenceContext,
  anchor = {},
  expectedAggregateVersion = null,
  commandId = "",
} = {}) {
  const { normalizedCommandId } = normalizeAnchoredCommandRequest({
    userId,
    sessionId,
    anchor,
    commandId,
  });
  const request = parseMessageDeleteRequest({
    commandId: normalizedCommandId,
    anchor,
    expectedAggregateVersion,
  });
  return commitMutation.call(this, {
    userId,
    sessionId,
    persistenceContext,
    createResponse: createMessageDeleteResponse,
    changeType: "messageDeletion",
    change: request,
  });
}

export async function replaceTurn({
  userId,
  sessionId,
  persistenceContext,
  anchor = {},
  newContent = "",
  turnScopeId = "",
  expectedAggregateVersion = null,
  commandId = "",
  attachments,
} = {}) {
  const normalizedNewContent = text(newContent);
  if (!normalizedNewContent) throw badRequest("newContent is required");
  const { normalizedCommandId } = normalizeAnchoredCommandRequest({
    userId,
    sessionId,
    anchor,
    commandId,
  });
  const normalizedTurnScopeId = text(turnScopeId);
  if (!normalizedTurnScopeId) throw badRequest("turnScopeId is required");
  const command = parseTurnReplaceRequest({
    commandId: normalizedCommandId,
    expectedAggregateVersion,
    anchor,
    newContent: normalizedNewContent,
    turnScopeId: normalizedTurnScopeId,
    attachments,
  });
  return commitMutation.call(this, {
    userId,
    sessionId,
    persistenceContext,
    createResponse: createTurnReplaceResponse,
    changeType: "turnReplacement",
    change: {
      command,
      identity: {
        dialogProcessId: this.allocateDialogProcessId(),
        messageUid: createMessageUid(),
        userMessageId: createUserMessageId(),
      },
    },
  });
}
