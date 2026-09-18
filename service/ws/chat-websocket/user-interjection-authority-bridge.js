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

const text = (value) => String(value || "").trim();

export function createUserInterjectionAuthorityBridge({ resolveBot } = {}) {
  return async function commitUserInterjection({ activeRun = {}, interjection = {} } = {}) {
    const bot = resolveBot?.();
    if (typeof bot?.commitAuthorityEvent !== "function") {
      throw new Error("commitAuthorityEvent is required");
    }
    const userId = text(activeRun.userId);
    const sessionId = text(activeRun.sessionId);
    const parentSessionId = text(activeRun.parentSessionId);
    const dialogProcessId = text(activeRun.dialogProcessId);
    const turnScopeId = text(activeRun.turnScopeId);
    const messageId = text(activeRun.messageId);
    const presentationMessageId = text(activeRun.presentationMessageId);
    const commandId = text(interjection.commandId);
    if (
      !userId ||
      !sessionId ||
      !dialogProcessId ||
      !turnScopeId ||
      !messageId ||
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
      messageId,
      presentationMessageId,
    });
    const payload = Object.freeze({
      eventType: MESSAGE_EVENT_TYPE.USER_INTERJECTION,
      presentationMessageId,
      dialogProcessId,
      contentFact,
    });
    assertMessageEventPayload(payload);
    const committed = await bot.commitAuthorityEvent({
      userId,
      sessionId,
      parentSessionId,
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      identity: {
        eventType: MESSAGE_EVENT_WIRE_EVENT,
        turnScopeId,
        messageId,
      },
      causality: { commandId, causationId: commandId },
      ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: messageId },
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
