/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSessionDetailApplicator } from "../../../../../../src/modules/session/model/list/sessionDetailApply.js";
import {
  buildAppendMessage,
  buildViewMessage,
} from "../../../../../../src/modules/chat/model/messageModel.js";
import { dispatchTurnEnvelope } from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { canonicalMessageEvent } from "../../../chat/helpers/messageEventFixture.js";
import { createUserInterjectionContentFact } from "@noobot/event-protocol/thinking-detail-content";
import { availableDetailDocument } from "../../../../helpers/sessionDetailFixture.js";

function message(messageUid, turnScopeId) {
  return {
    messageUid,
    userMessageId: messageUid,
    role: "user",
    content: messageUid,
    attachments: [],
    turnScopeId,
    dialogProcessId: `dialog-${turnScopeId}`,
  };
}

function document(messages, aggregateVersion = 2, sessionId = "s1", generation = 10) {
  return availableDetailDocument({
    sessionId,
    title: sessionId,
    aggregateVersion,
    generation,
    messages,
    turnTimings: [],
  });
}

function fixture(makeViewMessage = (value) => ({ ...value })) {
  const sessions = ref([
    { sessionId: "s1", aggregateVersion: 1, knownGeneration: null, messages: [], title: "before" },
    { sessionId: "s2", aggregateVersion: 1, knownGeneration: null, messages: [], title: "other" },
  ]);
  const chatStore = { applyTurnTimingSnapshot: vi.fn() };
  const onSessionDetailApplied = vi.fn();
  const applicator = createSessionDetailApplicator({
    sessions,
    chatStore,
    makeViewMessage,
    onSessionDetailApplied,
  });
  return { ...applicator, sessions, chatStore, onSessionDetailApplied };
}

describe("session detail authority", () => {
  it("applies a queued interjection after a same-message snapshot and gap repair", () => {
    const { applySessionDetail, sessions } = fixture(buildViewMessage);
    const identity = {
      sessionId: "s1",
      turnScopeId: "turn-a",
      dialogProcessId: "dialog-a",
      presentationMessageId: "assistant-a",
    };
    const assistant = {
      ...identity,
      role: "assistant",
      messageUid: "assistant-uid",
      content: "",
      attachments: [],
      ts: "2026-01-01T00:00:00.000Z",
    };
    const deliver = (sequence, overrides = {}) =>
      dispatchTurnEnvelope({
        targetMessage: sessions.value[0].messages[0],
        envelope: canonicalMessageEvent({
          ...identity,
          eventId: `event-${sequence}`,
          sequence,
          ...overrides,
        }),
      });
    const contentFact = createUserInterjectionContentFact({
      ...identity,
      sequence: 1,
      messageUid: "interjection-uid",
      message: "latest interjection",
      receivedAt: assistant.ts,
    });

    applySessionDetail(document([assistant], 2, "s1", 11));
    expect(deliver(1).applied).toBe(true);
    expect(deliver(3, { eventType: "user_interjection", contentFact }).reason).toBe("sequence_gap");
    applySessionDetail(document([assistant], 2, "s1", 12));
    expect(deliver(2, { eventType: "tool_call_end", success: true }).applied).toBe(true);
    expect(sessions.value[0].messages[0].thinkingContentTimeline).toEqual([contentFact]);
    expect(sessions.value[0].messages[0].messageEventState.lastSequence).toBe(3);

    const nextTurn = { ...assistant, turnScopeId: "turn-b", dialogProcessId: "dialog-b" };
    applySessionDetail(document([nextTurn], 3, "s1", 13));
    expect(sessions.value[0].messages[0].messageEventState.lastSequence).toBe(0);
    expect(sessions.value[0].messages[0].thinkingContentTimeline).toBeUndefined();
  });

  it("applies the committed snapshot while a composer draft is awaiting its message identity", () => {
    const { applySessionDetail, sessions } = fixture(buildViewMessage);
    const session = sessions.value[0];
    session.messages.push(
      buildAppendMessage({
        sessionId: session.sessionId,
        role: "user",
        content: "question",
        attachments: [],
        options: { userMessageId: "request-user", turnScopeId: "turn-a" },
      }),
    );
    expect(session.messages[0]).not.toHaveProperty("messageUid");

    const committed = {
      ...message("stored-user", "turn-a"),
      userMessageId: "request-user",
      content: "question",
      ts: "2026-01-01T00:00:00.000Z",
    };
    expect(applySessionDetail(document([committed]))).toBe(true);
    expect(session.messages).toEqual([expect.objectContaining(committed)]);
  });

  it("preserves the authoritative source count when only a subset are display rows", () => {
    const { applySessionDetail, sessions } = fixture();
    const detail = document([message("visible", "a")]);
    detail.sessions[0].stats.messageCount = 50;
    applySessionDetail(detail);
    expect(sessions.value[0].messageCount).toBe(50);
    expect(sessions.value[0].messages).toHaveLength(1);
  });

  it("uses head generation for same-version edits and rejects late snapshots before side effects", () => {
    const { applySessionDetail, sessions, chatStore, onSessionDetailApplied } = fixture();
    applySessionDetail(document([message("before", "a")], 2, "s1", 11));
    applySessionDetail(document([message("edited", "a"), message("later", "b")], 2, "s1", 12));
    expect(sessions.value[0].sessionDocs[0].generation).toBe(12);
    expect(sessions.value[0].detailMessages.map((item) => item.messageUid)).toEqual([
      "edited",
      "later",
    ]);
    const current = JSON.stringify(sessions.value);
    chatStore.applyTurnTimingSnapshot.mockClear();
    onSessionDetailApplied.mockClear();
    applySessionDetail(document([message("stale", "a")], 2, "s1", 11));
    expect(JSON.stringify(sessions.value)).toBe(current);
    expect(chatStore.applyTurnTimingSnapshot).not.toHaveBeenCalled();
    expect(onSessionDetailApplied).not.toHaveBeenCalled();
  });

  it("retains partial and interleaved turns exactly as stored in the detail", () => {
    const { applySessionDetail, sessions } = fixture();
    const messages = [
      message("keep-a", "a"),
      message("keep-b", "b"),
      message("later-a", "a"),
      message("new-c", "c"),
    ];
    applySessionDetail(document(messages));
    expect(sessions.value[0].detailMessages.map((item) => item.messageUid)).toEqual(
      messages.map((item) => item.messageUid),
    );
    expect(sessions.value[0].messages.map((item) => item.messageUid)).toEqual(
      messages.map((item) => item.messageUid),
    );
  });

  it("rejects an older detail before changing any projection or notifying consumers", () => {
    const { applySessionDetail, sessions, chatStore, onSessionDetailApplied } = fixture();
    applySessionDetail(document([message("edited", "a"), message("new", "b")], 5));
    const current = JSON.stringify(sessions.value);
    chatStore.applyTurnTimingSnapshot.mockClear();
    onSessionDetailApplied.mockClear();
    applySessionDetail(document([message("old", "a")], 4));
    expect(JSON.stringify(sessions.value)).toBe(current);
    expect(chatStore.applyTurnTimingSnapshot).not.toHaveBeenCalled();
    expect(onSessionDetailApplied).not.toHaveBeenCalled();
  });

  it("applies a response only to its declared session", () => {
    const { applySessionDetail, sessions } = fixture();
    const other = JSON.stringify(sessions.value[1]);
    applySessionDetail(document([message("keep", "a")]));
    expect(JSON.stringify(sessions.value[1])).toBe(other);
    expect(sessions.value[0].aggregateVersion).toBe(2);
  });
});
