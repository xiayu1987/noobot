/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createHash } from "node:crypto";
import { isPlainObject } from "@noobot/shared/value";
import {
  SESSION_ERROR_CODE,
  isTerminalTurnState,
  requireDialogProcessKey,
} from "@noobot/session-protocol";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { requireSessionChanges } from "@noobot/session-protocol/session-changes";

function invalidRequest(detail) {
  const error = new TypeError(`invalid turn summary checkpoint request: ${detail}`);
  error.code = SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID;
  error.statusCode = 400;
  return error;
}

function requireRequestText(value, field) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw invalidRequest(`${field} must be a non-empty trimmed string`);
  }
  return value;
}

function requireMessageUids(values, field) {
  if (!Array.isArray(values)) throw invalidRequest(`${field} must be an array`);
  values.forEach((uid) => requireRequestText(uid, `${field}[]`));
  if (new Set(values).size !== values.length) {
    throw invalidRequest(`${field} must not contain duplicates`);
  }
  return values;
}

function checkpointDigest({
  dialogProcessId,
  turnScopeId,
  persistedMessageUids,
  summarizedMessageUids,
  retainedMessageUids,
  messages,
  messageContentAppends = [],
  messageContentReplacements,
  messageMetadataUpdates = [],
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dialogProcessId,
        turnScopeId,
        persistedMessageUids,
        summarizedMessageUids,
        retainedMessageUids,
        messages,
        ...(messageContentAppends.length ? { messageContentAppends } : {}),
        ...(messageContentReplacements === undefined ? {} : { messageContentReplacements }),
        ...(messageMetadataUpdates.length ? { messageMetadataUpdates } : {}),
      }),
    )
    .digest("hex");
}

function requireCheckpointRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)
    throw invalidRequest(
      "expectedCheckpointRevision must be a non-negative safe integer with a safe successor",
    );
  return value;
}

export function createSummaryCheckpointId(request) {
  const predecessor = requireCheckpointRevision(request.expectedCheckpointRevision);
  return `summary_checkpoint_${checkpointDigest(request).slice(0, 32)}_${predecessor}`;
}

export function assertSummaryCheckpointSource({
  dialogProcessId,
  turnScopeId,
  persistedMessageUids,
  checkpointMessages,
  summarizedMessageUids,
}) {
  requireDialogProcessKey(dialogProcessId);
  requireCanonicalTurnScopeId(turnScopeId);
  requireMessageUids(persistedMessageUids, "persistedMessageUids");
  requireMessageUids(summarizedMessageUids, "summarizedMessageUids");
  if (summarizedMessageUids.length === 0) {
    throw invalidRequest("summary checkpoint source requires summarized messages");
  }
  if (
    !Array.isArray(checkpointMessages) ||
    persistedMessageUids.length !== checkpointMessages.length ||
    checkpointMessages.some((message, index) => message.messageUid !== persistedMessageUids[index])
  ) {
    throw invalidRequest("persisted UIDs must match the ordered checkpoint working set");
  }
}

export function parseTurnSummaryCheckpointRequest(payload) {
  if (!isPlainObject(payload)) {
    throw invalidRequest("payload must be an object");
  }
  const request = {
    userId: requireRequestText(payload.userId, "userId"),
    sessionId: requireRequestText(payload.sessionId, "sessionId"),
    dialogProcessId: requireDialogProcessKey(payload.dialogProcessId),
    turnScopeId: requireCanonicalTurnScopeId(payload.turnScopeId),
    checkpointId: requireRequestText(payload.checkpointId, "checkpointId"),
    expectedCheckpointRevision: requireCheckpointRevision(payload.expectedCheckpointRevision),
    persistedMessageUids: requireMessageUids(payload.persistedMessageUids, "persistedMessageUids"),
    summarizedMessageUids: requireMessageUids(
      payload.summarizedMessageUids,
      "summarizedMessageUids",
    ),
    retainedMessageUids: requireMessageUids(payload.retainedMessageUids, "retainedMessageUids"),
    messages: payload.messages,
    messageContentAppends: payload.messageContentAppends ?? [],
    ...(Object.hasOwn(payload, "messageContentReplacements")
      ? { messageContentReplacements: payload.messageContentReplacements }
      : {}),
    messageMetadataUpdates: payload.messageMetadataUpdates ?? [],
  };
  if (!Array.isArray(request.messages)) throw invalidRequest("messages must be an array");
  const persisted = new Set(request.persistedMessageUids);
  const completeMessageUids = new Set();
  for (const message of request.messages) {
    if (!isPlainObject(message)) throw invalidRequest("messages[] must be an object");
    const uid = requireRequestText(message.messageUid, "messages[].messageUid");
    if (completeMessageUids.has(uid)) throw invalidRequest("complete message UIDs must be unique");
    completeMessageUids.add(uid);
  }
  const { messages, messageContentAppends, messageContentReplacements, messageMetadataUpdates } =
    request;
  const changes = requireSessionChanges({
    messages,
    messageContentAppends,
    ...(Object.hasOwn(request, "messageContentReplacements") ? { messageContentReplacements } : {}),
    messageMetadataUpdates,
  });
  for (const message of Object.values(changes).flat()) {
    if (!isPlainObject(message)) throw invalidRequest("messages[] must be an object");
    const uid = requireRequestText(message.messageUid, "messages[].messageUid");
    if (!persisted.has(uid))
      throw invalidRequest("changed message UIDs must be members of persistedMessageUids");
    if (
      message.dialogProcessId !== request.dialogProcessId ||
      message.turnScopeId !== request.turnScopeId
    )
      throw invalidRequest("changed messages must belong to the checkpoint dialog and turn");
  }
  request.requestHash = `sha256:${checkpointDigest(request)}`;
  return request;
}

function checkpointConflict(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

export function assertSummaryCheckpointTurnOwnership(session, request) {
  const lifecycleTurn = session.turnLifecycle.turns[request.turnScopeId];
  if (lifecycleTurn && lifecycleTurn.dialogProcessId !== request.dialogProcessId) {
    throw checkpointConflict(
      "checkpoint does not own the lifecycle turn",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT,
    );
  }
}

export function assertSummaryCheckpointTargetsTurn(session, request) {
  assertSummaryCheckpointTurnOwnership(session, request);
  const lifecycle = session.turnLifecycle;
  const lifecycleTurn = lifecycle.turns[request.turnScopeId];
  if (lifecycleTurn) {
    if (isTerminalTurnState(lifecycleTurn.state) && request.persistedMessageUids.length) {
      throw checkpointConflict(
        "terminal checkpoint cannot persist additional messages",
        SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE,
      );
    }
  }
  if (lifecycle.activeTurnScopeId && lifecycle.activeTurnScopeId !== request.turnScopeId) {
    throw checkpointConflict(
      "checkpoint does not target the active turn",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE,
    );
  }
}

export function assertSummaryCheckpointDisposition(request) {
  const summarizedSet = new Set(request.summarizedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => summarizedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint cannot summarize and retain the same message",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT,
    );
  }
  const persistedSet = new Set(request.persistedMessageUids);
  if (request.retainedMessageUids.some((messageUid) => !persistedSet.has(messageUid))) {
    throw checkpointConflict(
      "checkpoint retained messages must belong to its persisted message set",
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING,
    );
  }
}
