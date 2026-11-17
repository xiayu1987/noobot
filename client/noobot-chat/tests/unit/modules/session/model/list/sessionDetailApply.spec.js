/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSessionDetailApplicator } from "../../../../../../src/modules/session/model/list/sessionDetailApply.js";
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

function fixture() {
  const sessions = ref([
    { sessionId: "s1", aggregateVersion: 1, generation: null, messages: [], title: "before" },
    { sessionId: "s2", aggregateVersion: 1, generation: null, messages: [], title: "other" },
  ]);
  const chatStore = { applyTurnTimingSnapshot: vi.fn() };
  const onSessionDetailApplied = vi.fn();
  const applicator = createSessionDetailApplicator({
    sessions,
    chatStore,
    makeViewMessage: (value) => ({ ...value }),
    onSessionDetailApplied,
  });
  return { ...applicator, sessions, chatStore, onSessionDetailApplied };
}

describe("session detail authority", () => {
  it("uses head generation for same-version edits and rejects late snapshots before side effects", () => {
    const { applySessionDetail, sessions, chatStore, onSessionDetailApplied } = fixture();
    applySessionDetail(document([message("before", "a")], 2, "s1", 11));
    applySessionDetail(document([message("edited", "a"), message("later", "b")], 2, "s1", 12));
    expect(sessions.value[0].generation).toBe(12);
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
