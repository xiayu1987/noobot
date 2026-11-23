/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnAttachmentBindFingerprint,
  normalizeExpectedAggregateVersion,
} from "@noobot/session-protocol";
import { AttachmentProtocolError } from "@noobot/attachment-protocol";
import {
  INVALID_CANONICAL_ATTACHMENT_ERROR_CODE,
  assertCanonicalAttachments,
} from "../artifacts/index.js";
import { text } from "@noobot/shared/value";
import { dedupeSessionAttachmentRefs } from "./transfer-attachment-refs.js";

export function prepareAttachmentBinding({
  userId,
  sessionId,
  turnScopeId,
  messageUid,
  commandId,
  attachments,
  expectedAggregateVersion,
}) {
  const identity = {
    userId: text(userId),
    sessionId: text(sessionId),
    turnScopeId: text(turnScopeId),
    messageUid: text(messageUid),
    commandId: text(commandId),
  };
  if (Object.values(identity).some((value) => !value))
    throw Object.assign(new TypeError("attachment binding identity is incomplete"), {
      statusCode: 400,
    });
  assertCanonicalAttachments(attachments, identity.sessionId);
  const canonicalAttachments = normalizeBindingAttachments(attachments);
  if (canonicalAttachments.length === 0)
    throw Object.assign(new TypeError("attachment binding requires at least one attachment"), {
      statusCode: 400,
      code: INVALID_CANONICAL_ATTACHMENT_ERROR_CODE,
    });
  return {
    identity,
    canonicalAttachments,
    normalizedExpectedVersion: normalizeExpectedAggregateVersion(expectedAggregateVersion),
    requestHash: createTurnAttachmentBindFingerprint({
      turnScopeId: identity.turnScopeId,
      messageUid: identity.messageUid,
      attachments: canonicalAttachments,
    }),
  };
}

function normalizeBindingAttachments(attachments) {
  try {
    return dedupeSessionAttachmentRefs(attachments);
  } catch (cause) {
    if (!(cause instanceof AttachmentProtocolError)) throw cause;
    throw Object.assign(new TypeError(cause.message, { cause }), {
      statusCode: 400,
      code: INVALID_CANONICAL_ATTACHMENT_ERROR_CODE,
    });
  }
}
