/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { SESSION_ERROR_CODE } from "../errors.js";
import { isCanonicalDialogProcessKey } from "../identity.js";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import {
  MESSAGE_FIELD_SCHEMA,
  messageRecordIdentityFieldsFor,
} from "../identity/message-identity-schema.js";

const PRESENTATION_FIELD = "presentationMessageId";

if (!Object.hasOwn(MESSAGE_FIELD_SCHEMA, PRESENTATION_FIELD)) {
  throw new TypeError(`${PRESENTATION_FIELD} is not a registered message identity field`);
}

function partitionError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function bearsPresentation(message) {
  return messageRecordIdentityFieldsFor(message.role).required.includes(PRESENTATION_FIELD);
}

function readTurnPartitionMessageIdentity(message, position) {
  if (
    !isPlainObject(message) ||
    !isCanonicalTurnScopeId(message.turnScopeId) ||
    !isCanonicalDialogProcessKey(message.dialogProcessId)
  ) {
    throw partitionError(
      SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
      `session message is missing Turn identity at index ${position}`,
    );
  }
  if (!bearsPresentation(message)) {
    return { turnScopeId: message.turnScopeId, dialogProcessId: message.dialogProcessId };
  }
  if (!isCanonicalText(message[PRESENTATION_FIELD])) {
    throw partitionError(
      SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
      `session message is missing ${PRESENTATION_FIELD} at index ${position}`,
    );
  }
  return {
    turnScopeId: message.turnScopeId,
    dialogProcessId: message.dialogProcessId,
    presentationMessageId: message[PRESENTATION_FIELD],
  };
}

const immutableMessageIdentities = new WeakMap();

export function requireTurnPartitionMessageIdentity(message, position) {
  if (!isDeepFrozen(message)) return readTurnPartitionMessageIdentity(message, position);
  let identity = immutableMessageIdentities.get(message);
  if (!identity) {
    identity = Object.freeze(readTurnPartitionMessageIdentity(message, position));
    immutableMessageIdentities.set(message, identity);
  }
  return { ...identity };
}

function mergePartitionIdentity(identity, next) {
  if (next.turnScopeId !== identity.turnScopeId)
    return `Turn partition mixes turnScopeId ${identity.turnScopeId} and ${next.turnScopeId}`;
  if (next.dialogProcessId !== identity.dialogProcessId)
    return `turnScopeId ${identity.turnScopeId} maps to multiple dialogProcessId values`;
  if (!next.presentationMessageId) return "";
  if (identity.presentationMessageId === null)
    identity.presentationMessageId = next.presentationMessageId;
  return identity.presentationMessageId === next.presentationMessageId
    ? ""
    : `turnScopeId ${identity.turnScopeId} maps to multiple presentationMessageId values`;
}

function assertPartitionConflict(conflict) {
  if (conflict) throw partitionError(SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT, conflict);
}

export function partitionTurnMessages(messages) {
  const buckets = new Map();
  messages.forEach((message, sourceIndex) => {
    const next = requireTurnPartitionMessageIdentity(message, sourceIndex);
    let bucket = buckets.get(next.turnScopeId);
    if (!bucket) {
      bucket = {
        turnScopeId: next.turnScopeId,
        dialogProcessId: next.dialogProcessId,
        firstSourceIndex: sourceIndex,
        messages: [],
        identity: { presentationMessageId: null, ...next },
        conflict: "",
      };
      buckets.set(next.turnScopeId, bucket);
    } else bucket.conflict ||= mergePartitionIdentity(bucket.identity, next);
    bucket.messages.push(message);
  });
  for (const bucket of buckets.values()) assertPartitionConflict(bucket.conflict);
  return [...buckets.values()].map(({ identity, conflict, ...bucket }) => bucket);
}

export function requireTurnPartitionIdentity(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw partitionError(
      SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
      "Turn partition requires at least one message",
    );
  }
  let identity;
  let conflict = "";
  messages.forEach((message, index) => {
    const next = requireTurnPartitionMessageIdentity(message, index);
    if (!identity) identity = { presentationMessageId: null, ...next };
    else conflict ||= mergePartitionIdentity(identity, next);
  });
  assertPartitionConflict(conflict);
  return Object.freeze(identity);
}
