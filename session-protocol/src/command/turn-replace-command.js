/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { canonicalAttachmentIdentities, createCommandRequestHash } from "./command-fingerprint.js";
import { parseMessageDeleteRequest } from "./message-delete-command.js";
import { isNaturalDialogUserMessage } from "../message-entity-contract.js";

export function matchesTurnReplacementAnchor({ first, indexedMessageUid, candidate }) {
  return (
    isCanonicalText(indexedMessageUid) &&
    candidate?.message?.messageUid === indexedMessageUid &&
    candidate.message.sessionId === first.message.sessionId &&
    candidate.message.dialogProcessId === first.message.dialogProcessId &&
    Number.isSafeInteger(candidate.ordinal) &&
    candidate.ordinal > 0 &&
    Number.isSafeInteger(first.ordinal) &&
    candidate.ordinal <= first.ordinal &&
    isNaturalDialogUserMessage(candidate.message)
  );
}

export function parseTurnReplaceRequest(request) {
  if (!isPlainObject(request)) throw new TypeError("Turn replacement request must be an object");
  request = JSON.parse(JSON.stringify(request));
  if (
    !isPlainObject(request) ||
    Object.keys(request).some(
      (key) =>
        ![
          "commandId",
          "anchor",
          "expectedAggregateVersion",
          "newContent",
          "turnScopeId",
          "attachments",
        ].includes(key),
    ) ||
    !isCanonicalText(request.newContent) ||
    !isCanonicalText(request.turnScopeId) ||
    !Array.isArray(request.attachments) ||
    request.attachments.some((attachment) => !isPlainObject(attachment))
  )
    throw new TypeError("Turn replacement requires canonical content, turn scope and attachments");
  for (const attachment of request.attachments) projectAttachmentIdentity(attachment);
  const command = parseMessageDeleteRequest({
    commandId: request.commandId,
    anchor: request.anchor,
    expectedAggregateVersion: request.expectedAggregateVersion,
  });
  return deepFreeze({
    ...command,
    newContent: request.newContent,
    turnScopeId: request.turnScopeId,
    attachments: request.attachments,
  });
}

export function parseTurnReplacementChange(request) {
  if (!isPlainObject(request)) throw new TypeError("Turn replacement change must be an object");
  request = JSON.parse(JSON.stringify(request));
  const fields = ["dialogProcessId", "messageUid", "userMessageId"];
  if (
    !isPlainObject(request) ||
    Object.keys(request).some((key) => !["command", "identity"].includes(key)) ||
    !isPlainObject(request.identity) ||
    Object.keys(request.identity).some((key) => !fields.includes(key)) ||
    fields.some((key) => !isCanonicalText(request.identity[key]))
  )
    throw new TypeError("Turn replacement requires canonical message, user and dialog identities");
  return deepFreeze({
    command: parseTurnReplaceRequest(request.command),
    identity: Object.fromEntries(fields.map((key) => [key, request.identity[key]])),
  });
}

export function createTurnReplaceFingerprint({
  anchor = {},
  newContent = "",
  turnScopeId = "",
  attachments,
} = {}) {
  return createCommandRequestHash({
    type: "session.turn.replace",
    anchor,
    newContent: clean(newContent),
    turnScopeId: clean(turnScopeId),
    attachments: canonicalAttachmentIdentities(attachments),
  });
}
