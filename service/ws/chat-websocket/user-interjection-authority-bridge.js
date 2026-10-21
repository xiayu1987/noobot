/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
  assertMessageEventPayload,
} from "@noobot/event-protocol/message-event";
import { createUserInterjectionContentFact } from "@noobot/event-protocol/thinking-detail-content";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";

export function createUserInterjectionAuthorityBridge({ resolveBot, persistenceScope }) {
  const scope = createSessionPersistenceScope(persistenceScope);
  return async function commitUserInterjection({ activeRun, interjection }) {
    const { session } = resolveBot();
    const userId = text(activeRun.userId);
    const sessionId = text(activeRun.sessionId);
    const dialogProcessId = text(activeRun.dialogProcessId);
    const turnScopeId = text(activeRun.turnScopeId);
    const presentationMessageId = text(activeRun.presentationMessageId);
    const commandId = text(interjection.commandId);
    if (
      !userId ||
      !sessionId ||
      !dialogProcessId ||
      !turnScopeId ||
      !presentationMessageId ||
      !commandId
    ) {
      throw new TypeError("user interjection authority commit requires canonical Turn identity");
    }
    const contentFact = createUserInterjectionContentFact({
      messageUid: interjection.messageUid,
      message: interjection.message,
      receivedAt: interjection.receivedAt,
      sequence: interjection.interjectionSequence,
      sessionId,
      dialogProcessId,
      turnScopeId,
      presentationMessageId,
    });
    const payload = Object.freeze({
      eventType: MESSAGE_EVENT_TYPE.USER_INTERJECTION,
      presentationMessageId,
      dialogProcessId,
      contentFact,
    });
    assertMessageEventPayload(payload);
    const committed = await session.commitAuthorityEvent({
      userId,
      sessionId,
      persistenceScope: scope,
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      identity: {
        eventType: MESSAGE_EVENT_WIRE_EVENT,
        turnScopeId,
      },
      causality: { commandId, causationId: commandId },
      ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: presentationMessageId },
      producer: { type: "service", id: "websocket.user-interjection" },
      payload,
    });
    if (!committed?.committed || !committed?.envelope) {
      throw new Error(
        `user interjection authority event commit failed: ${committed?.reason || "unknown"}`,
      );
    }
    return committed.envelope;
  };
}
