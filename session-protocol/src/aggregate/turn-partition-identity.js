/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
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

export function requireTurnPartitionMessageIdentity(message, position) {
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

export function requireTurnPartitionIdentity(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw partitionError(
      SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
      "Turn partition requires at least one message",
    );
  }
  const [first, ...rest] = messages.map(requireTurnPartitionMessageIdentity);
  const identity = { presentationMessageId: null, ...first };
  rest.forEach((next) => {
    if (next.turnScopeId !== identity.turnScopeId) {
      throw partitionError(
        SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
        `Turn partition mixes turnScopeId ${identity.turnScopeId} and ${next.turnScopeId}`,
      );
    }
    if (next.dialogProcessId !== identity.dialogProcessId) {
      throw partitionError(
        SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
        `turnScopeId ${identity.turnScopeId} maps to multiple dialogProcessId values`,
      );
    }
    if (!next.presentationMessageId) return;
    if (identity.presentationMessageId === null) {
      identity.presentationMessageId = next.presentationMessageId;
      return;
    }
    if (identity.presentationMessageId !== next.presentationMessageId) {
      throw partitionError(
        SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
        `turnScopeId ${identity.turnScopeId} maps to multiple presentationMessageId values`,
      );
    }
  });
  return Object.freeze(identity);
}
