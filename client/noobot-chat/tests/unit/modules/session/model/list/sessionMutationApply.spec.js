/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSessionMutationApplicator } from "../../../../../../src/modules/session/model/list/sessionMutationApply.js";
import { createSessionDetailApplicator } from "../../../../../../src/modules/session/model/list/sessionDetailApply.js";
import {
  availableDetailDocument,
  messageDeleteResponse,
  missingDetailDocument,
  unavailableDetailDocument,
} from "../../../../helpers/sessionDetailFixture.js";

const message = (uid, scope) => ({
  messageUid: uid,
  userMessageId: uid,
  role: "user",
  content: uid,
  turnScopeId: scope,
  dialogProcessId: `dialog:${scope}`,
  attachments: [],
});
function document(messages, generation = 9) {
  return availableDetailDocument({
    sessionId: "s1",
    title: "before",
    aggregateVersion: 1,
    generation,
    messages,
    turnTimings: [],
  });
}
function response() {
  const value = messageDeleteResponse({
    commandId: "delete-1",
    sessionId: "s1",
    aggregateVersion: 2,
    deletedCount: 2,
    anchorIndex: 2,
    deletedTurnScopeIds: ["gone"],
    deduplicated: false,
  });

  return {
    ...value,
    deletedMessageUids: ["remove-a", "remove-c"],
    projection: { ...value.projection, deletedMessageUids: ["remove-a", "remove-c"] },
  };
}
function fixture(messages = [], generation = 9) {
  const sessions = ref([{ sessionId: "s1", aggregateVersion: 1, generation: null, messages: [] }]);
  const detail = createSessionDetailApplicator({
    sessions,
    chatStore: { applyTurnTimingSnapshot: vi.fn() },
    makeViewMessage: (value) => ({ ...value }),
    onSessionDetailApplied: vi.fn(),
  });
  const applySessionDetail = vi.fn(detail.applySessionDetail);
  applySessionDetail(document(messages, generation));
  applySessionDetail.mockClear();
  const fetchSessionDetail = vi.fn();
  const applySessionMutation = createSessionMutationApplicator({
    sessions,
    applySessionDetail,
    fetchSessionDetail,
  });
  return { sessions, applySessionDetail, fetchSessionDetail, applySessionMutation };
}

describe("session mutation application", () => {
  it("preserves the retained prefix of an interleaved turn and unrelated dialog documents", async () => {
    const f = fixture([
      message("keep-a", "a"),
      message("keep-b", "b"),
      message("remove-a", "a"),
      message("remove-c", "gone"),
    ]);
    const childEntry = availableDetailDocument({
      sessionId: "child",
      title: "child",
      aggregateVersion: 1,
      generation: 2,
      messages: [],
      turnTimings: [],
    }).sessions[0];
    f.sessions.value[0].sessionDocs.push(childEntry);
    expect(await f.applySessionMutation(response())).toBe(true);
    expect(f.sessions.value[0].detailMessages.map((value) => value.messageUid)).toEqual([
      "keep-a",
      "keep-b",
    ]);
    expect(f.sessions.value[0].generation).toBe(10);
    expect(f.sessions.value[0].sessionDocs[1]).toEqual(childEntry);
    expect(f.fetchSessionDetail).not.toHaveBeenCalled();
  });
  it("does not replay old command effects over later edits or appended messages", async () => {
    const f = fixture([message("remove-a", "a"), message("later", "b")], 12);
    const before = JSON.stringify(f.sessions.value);
    expect(
      await f.applySessionMutation({ ...response(), deduplicated: true, generation: 12 }),
    ).toBe(true);
    expect(JSON.stringify(f.sessions.value)).toBe(before);
    expect(f.applySessionDetail).not.toHaveBeenCalled();
    expect(f.fetchSessionDetail).not.toHaveBeenCalled();
  });
  it("synchronizes a generation gap instead of applying the old effect", async () => {
    const f = fixture([message("old", "a")], 7);
    f.fetchSessionDetail.mockResolvedValue(document([message("later", "b")], 11));
    expect(
      await f.applySessionMutation({ ...response(), deduplicated: true, generation: 11 }),
    ).toBe(true);
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("later");
    expect(f.fetchSessionDetail).toHaveBeenCalledWith("s1", {
      source: "mutationGenerationGap",
      requireFresh: true,
    });
  });
  it("does not apply a pending synchronization to a rebuilt object with the same session ID", async () => {
    const f = fixture([], 7);
    let resolve;
    f.fetchSessionDetail.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.applySessionMutation(response());
    f.sessions.value[0] = { sessionId: "s1", aggregateVersion: 5, generation: 20 };
    resolve(document([message("late", "a")], 10));
    expect(await pending).toBe(false);
    expect(f.applySessionDetail).not.toHaveBeenCalled();
  });
  it("does not replace a newer document with a late synchronization", async () => {
    const f = fixture([], 7);
    let resolve;
    f.fetchSessionDetail.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = f.applySessionMutation(response());
    f.applySessionDetail(document([message("latest", "b")], 12));
    resolve(document([message("late", "a")], 10));
    expect(await pending).toBe(true);
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("latest");
  });
  it("does not report a missing synchronization result as successfully applied", async () => {
    const f = fixture([], 7);
    f.fetchSessionDetail.mockResolvedValue(missingDetailDocument({ sessionId: "s1" }));
    expect(await f.applySessionMutation(response())).toBe(false);
  });
  it("does not replace available messages with an unavailable synchronization result", async () => {
    const f = fixture([message("keep", "a")], 7);
    f.fetchSessionDetail.mockResolvedValue(
      unavailableDetailDocument({
        sessionId: "s1",
        unavailableReason: {
          code: "SESSION_IMMUTABLE_STORAGE_INVALID",
          message: "Damaged storage",
        },
      }),
    );
    expect(await f.applySessionMutation(response())).toBe(false);
    expect(f.applySessionDetail).not.toHaveBeenCalled();
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("keep");
  });
  it("rejects a synchronization result belonging to another session", async () => {
    const f = fixture([], 7);
    f.fetchSessionDetail.mockResolvedValue(
      availableDetailDocument({
        sessionId: "other",
        title: "other",
        aggregateVersion: 2,
        generation: 10,
        messages: [],
        turnTimings: [],
      }),
    );
    await expect(f.applySessionMutation(response())).rejects.toThrow("different session");
    expect(f.applySessionDetail).not.toHaveBeenCalled();
  });
  it("does not report a stale synchronization result as successfully applied", async () => {
    const f = fixture([], 7);
    f.fetchSessionDetail.mockResolvedValue(document([], 8));
    expect(await f.applySessionMutation(response())).toBe(false);
  });
});
