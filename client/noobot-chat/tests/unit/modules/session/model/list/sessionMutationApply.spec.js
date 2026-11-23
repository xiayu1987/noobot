/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSessionMutationApplicator } from "../../../../../../src/modules/session/model/list/sessionMutationApply.js";
import { createSessionDetailApplicator } from "../../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { createSessionDetailRequests } from "../../../../../../src/modules/session/model/list/sessionDetailRequests.js";
import {
  availableDetailDocument,
  detailResponse,
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
    messages: messages.map((value, index) => ({ sessionOrdinal: index + 1, ...value })),
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
    projection: {
      ...value.projection,
      turns: [
        { key: "a", value: null },
        { key: "gone", value: null },
      ],
    },
  };
}
function detailWithUnreadableChild(generation) {
  const main = document([], generation);
  const child = unavailableDetailDocument({
    sessionId: "child",
    unavailableReason: { code: "ATTACHMENT_METADATA_MISSING", message: "Missing metadata" },
  });
  return { ...main, sessions: [...main.sessions, { ...child.sessions[0], parentSessionId: "s1" }] };
}
function fixture(messages = [], generation = 9) {
  const sessions = ref([
    { sessionId: "s1", aggregateVersion: 1, knownGeneration: null, messages: [] },
  ]);
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
  it("keeps the applied snapshot intact after a failed refresh and rejects an older in-flight response", async () => {
    const f = fixture([message("old", "a")]);
    const old = Promise.withResolvers();
    const getSessionDetailApi = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error("refresh unavailable"))
      .mockResolvedValueOnce(detailResponse(document([], 10)));
    const { fetchSessionDetail } = createSessionDetailRequests({
      sessions: f.sessions,
      activeSessionId: ref("s1"),
      userId: ref("admin"),
      authFetch: vi.fn(),
      getSessionDetailApi,
      isSameSessionIdentity: (left, right) => left === right,
    });
    const applySessionMutation = createSessionMutationApplicator({
      sessions: f.sessions,
      applySessionDetail: f.applySessionDetail,
      fetchSessionDetail,
    });
    const pending = fetchSessionDetail("s1", { source: "selection" });
    await expect(applySessionMutation(response())).rejects.toThrow("refresh unavailable");
    const item = f.sessions.value[0];
    expect(item.knownGeneration).toBe(10);
    expect(item.sessionDocs[0].generation).toBe(9);
    expect(item.detailMessages.map(({ messageUid }) => messageUid)).toEqual(["old"]);
    expect(item.messageCount).toBe(1);
    expect(f.applySessionDetail).not.toHaveBeenCalled();

    const stale = expect(pending).rejects.toThrow("version is stale");
    old.resolve(detailResponse(document([message("old", "a")])));
    await stale;
    expect(await applySessionMutation(response())).toBe(true);
    expect(item.sessionDocs[0].generation).toBe(10);
    expect(item.detailMessages).toEqual([]);
    expect(item.messageCount).toBe(0);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(3);
  });

  it("publishes rows and counts from the refreshed detail before notifying consumers", async () => {
    const original = document([
      message("keep-a", "a"),
      message("keep-b", "b"),
      message("remove-a", "a"),
      message("remove-c", "gone"),
    ]);
    const refreshed = document([message("keep-a", "a"), message("keep-b", "b")], 10);
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 1, knownGeneration: null, messages: [] },
    ]);
    const observed = vi.fn(({ sessionItem }) => ({
      generation: sessionItem.sessionDocs[0].generation,
      count: sessionItem.messageCount,
      stats: sessionItem.sessionDocs[0].stats,
      rows: sessionItem.detailMessages.map(({ messageUid }) => messageUid),
    }));
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      chatStore: { applyTurnTimingSnapshot: vi.fn() },
      makeViewMessage: (value) => ({ ...value }),
      onSessionDetailApplied: observed,
    });
    const getSessionDetailApi = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(original))
      .mockResolvedValueOnce(detailResponse(refreshed));
    const { fetchSessionDetail } = createSessionDetailRequests({
      sessions,
      activeSessionId: ref("s1"),
      userId: ref("admin"),
      authFetch: vi.fn(),
      getSessionDetailApi,
      isSameSessionIdentity: (left, right) => left === right,
    });
    applySessionDetail(await fetchSessionDetail("s1", { source: "selection" }));
    expect(sessions.value[0].messageCount).toBe(4);

    const applySessionMutation = createSessionMutationApplicator({
      sessions,
      applySessionDetail,
      fetchSessionDetail,
    });
    expect(await applySessionMutation(response())).toBe(true);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
    expect(observed.mock.results[1].value).toEqual({
      generation: 10,
      count: 2,
      stats: refreshed.sessions[0].stats,
      rows: ["keep-a", "keep-b"],
    });
  });

  it("applies authoritative rows and statistics together even at the exact predecessor", async () => {
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
    const refreshed = document(
      [{ ...message("keep-a", "a"), content: "authoritative projection" }, message("keep-b", "b")],
      10,
    );
    f.fetchSessionDetail.mockResolvedValue({
      ...refreshed,
      sessions: [...refreshed.sessions, childEntry],
    });
    expect(await f.applySessionMutation(response())).toBe(true);
    expect(f.sessions.value[0].detailMessages.map((value) => value.messageUid)).toEqual([
      "keep-a",
      "keep-b",
    ]);
    expect(f.sessions.value[0].sessionDocs[0].generation).toBe(10);
    expect(f.sessions.value[0].detailMessages[0].content).toBe("authoritative projection");
    expect(f.sessions.value[0].sessionDocs[0].stats).toEqual(refreshed.sessions[0].stats);
    expect(f.sessions.value[0].sessionDocs[1]).toEqual(childEntry);
    expect(f.fetchSessionDetail).toHaveBeenCalledOnce();
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
  it("does not acknowledge a replay when the loaded detail trails the known aggregate version", async () => {
    const f = fixture([message("old", "a")], 12);
    f.sessions.value[0].aggregateVersion = 5;
    const replay = { ...response(), deduplicated: true, generation: 12 };
    f.fetchSessionDetail.mockRejectedValueOnce(new Error("detail request failed"));
    await expect(f.applySessionMutation(replay)).rejects.toThrow("detail request failed");
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("old");
    expect(f.sessions.value[0].sessionDocs[0].aggregateVersion).toBe(1);

    f.fetchSessionDetail.mockResolvedValueOnce(
      availableDetailDocument({
        sessionId: "s1",
        title: "current",
        aggregateVersion: 5,
        generation: 13,
        messages: [],
        turnTimings: [],
      }),
    );
    expect(await f.applySessionMutation(replay)).toBe(true);
    expect(f.sessions.value[0].sessionDocs[0].aggregateVersion).toBe(5);
    expect(f.sessions.value[0].messageCount).toBe(0);
  });
  it("synchronizes a generation gap instead of applying the old effect", async () => {
    const f = fixture([message("old", "a")], 7);
    f.fetchSessionDetail.mockResolvedValue(document([message("later", "b")], 11));
    expect(
      await f.applySessionMutation({ ...response(), deduplicated: true, generation: 11 }),
    ).toBe(true);
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("later");
    expect(f.fetchSessionDetail).toHaveBeenCalledWith("s1", {
      source: "mutationSynchronization",
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
    f.sessions.value[0] = { sessionId: "s1", aggregateVersion: 5, knownGeneration: 20 };
    resolve(document([message("late", "a")], 10));
    expect(await pending).toBe(false);
    expect(f.applySessionDetail).not.toHaveBeenCalled();
  });
  it.each([
    document([message("late", "a")], 10),
    detailWithUnreadableChild(12),
    unavailableDetailDocument({
      sessionId: "s1",
      unavailableReason: { code: "ATTACHMENT_METADATA_MISSING", message: "Missing metadata" },
    }),
  ])("does not replace a newer document with a late synchronization (%#)", async (lateDetail) => {
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
    resolve(lateDetail);
    expect(await pending).toBe(true);
    expect(f.sessions.value[0].detailMessages[0].messageUid).toBe("latest");
  });
  it("does not report a missing synchronization result as successfully applied", async () => {
    const f = fixture([], 7);
    f.fetchSessionDetail.mockResolvedValue(missingDetailDocument({ sessionId: "s1" }));
    expect(await f.applySessionMutation(response())).toBe(false);
  });
  it("invalidates the old projection when the synchronized child is unreadable", async () => {
    const f = fixture([message("keep", "a")], 7);
    f.fetchSessionDetail.mockResolvedValue(detailWithUnreadableChild(12));
    expect(await f.applySessionMutation(response())).toBe(false);
    expect(f.sessions.value[0]).toMatchObject({
      loaded: false,
      detailMessages: [],
      detailUnavailableReason: { code: "ATTACHMENT_METADATA_MISSING" },
    });
  });
  it("invalidates the old projection after an unavailable synchronization result", async () => {
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
    expect(f.sessions.value[0]).toMatchObject({
      loaded: false,
      detailMessages: [],
      detailUnavailableReason: { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    });
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
