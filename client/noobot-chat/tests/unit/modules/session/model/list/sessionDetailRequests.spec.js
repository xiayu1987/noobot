/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  availableDetailDocument,
  detailResponse,
} from "../../../../helpers/sessionDetailFixture.js";

const getSessionThinkingDetailApi = vi.fn();
vi.mock("../../../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionThinkingDetailApi: (...args) => getSessionThinkingDetailApi(...args),
}));

const { configureAuthenticatedFetcher } =
  await import("../../../../../../src/infrastructure/http/authenticatedHttpService.js");
const { createSessionDetailRequests } =
  await import("../../../../../../src/modules/session/model/list/sessionDetailRequests.js");
const { __resetThinkingDetailCacheForTests, loadThinkingDetail } =
  await import("../../../../../../src/modules/chat/model/thinkingDetailCache.js");

function response(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createRequests(overrides = {}) {
  return createSessionDetailRequests({
    sessions: ref([]),
    activeSessionId: ref(""),
    userId: ref("admin"),
    authFetch: vi.fn(),
    getSessionDetailApi: vi.fn(),
    isSameSessionIdentity: (left, right) => left === right,
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    ...overrides,
  });
}

describe("sessionDetailRequests thinking detail", () => {
  beforeEach(() => {
    configureAuthenticatedFetcher(vi.fn());
  });

  afterEach(() => {
    __resetThinkingDetailCacheForTests();
    getSessionThinkingDetailApi.mockReset();
    vi.restoreAllMocks();
  });

  it("preserves a retryable missing-detail result across the session request adapter", async () => {
    const detailPayload = {
      ok: true,
      exists: true,
      messageItem: {
        role: "assistant",
        sessionId: "session-eventual-detail",
        turnScopeId: "client-turn:eventual-detail",
        thinkingContentTimeline: [
          {
            contentId: "message:interjection-uid-command-1",
            contentKind: "user_interjection",
            text: "continue with the accepted correction",
            sequence: 1,
          },
        ],
      },
    };
    getSessionThinkingDetailApi
      .mockResolvedValueOnce(response({ ok: true, exists: false }))
      .mockResolvedValueOnce(response(detailPayload));
    const { fetchThinkingDetail } = createRequests();

    const detail = await loadThinkingDetail({
      sessionId: "session-eventual-detail",
      messageItem: {
        sessionId: "session-eventual-detail",
        turnScopeId: "client-turn:eventual-detail",
        dialogProcessId: "dp-eventual-detail",
      },
      fetchThinkingDetail,
      retryLimit: 1,
      retryDelayMs: 0,
    });

    expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(2);
    expect(getSessionThinkingDetailApi.mock.calls[0][0]).toEqual({
      userId: "admin",
      sessionId: "session-eventual-detail",
      dialogProcessId: "dp-eventual-detail",
      turnScopeId: "client-turn:eventual-detail",
    });
    expect(detail).toEqual(detailPayload);
  });

  it("passes the server failure envelope through unchanged", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(
      response({ ok: false, error: "denied" }, { status: 503 }),
    );
    const { fetchThinkingDetail } = createRequests();

    const error = await fetchThinkingDetail({
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp-1",
    }).catch((caught) => caught);
    expect(error.code).toBe("http");
    expect(error.status).toBe(503);
    expect(error.message).toBe("denied");
  });

  it("keeps the missing-detail code from the thinking detail service", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(response({ ok: true, exists: false }));
    const { fetchThinkingDetail } = createRequests();

    const error = await fetchThinkingDetail({
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp-1",
    }).catch((caught) => caught);
    expect(error.message).toBe("thinking detail not found");
    expect(error.code).toBe("not_found");
  });

  it("rejects a message without the complete protocol Turn lookup key", async () => {
    const { fetchThinkingDetail } = createRequests();

    for (const messageItem of [
      { sessionId: "s1", turnScopeId: "t1" },
      { sessionId: "s1", dialogProcessId: "dp-1" },
      { sessionId: "s1", turnScopeId: "t1", dialogProcessId: " dp-1 " },
    ]) {
      await expect(
        loadThinkingDetail({ sessionId: "s1", messageItem, fetchThinkingDetail }),
      ).rejects.toMatchObject({ code: SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID });
    }
    expect(getSessionThinkingDetailApi).not.toHaveBeenCalled();
  });
});

describe("session detail cache versions", () => {
  function document(aggregateVersion, generation = 10) {
    return availableDetailDocument({
      sessionId: "s1",
      title: "s1",
      aggregateVersion,
      generation,
      messages: [{ role: "user", messageUid: `message-${aggregateVersion}` }],
      turnTimings: [],
    });
  }

  function deferred() {
    let resolve;
    const promise = new Promise((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }

  it("shares an in-flight request only while the session version is unchanged", async () => {
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
    ]);
    const pending = deferred();
    const getSessionDetailApi = vi.fn().mockReturnValue(pending.promise);
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const first = fetchSessionDetail("s1", { source: "first" });
    const joined = fetchSessionDetail("s1", { source: "joined", requireFresh: true });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
    pending.resolve(detailResponse(document(2)));
    const [left, right] = await Promise.all([first, joined]);
    expect(left).toBe(right);
  });

  it("invalidates pending and recent responses when generation advances without a command version change", async () => {
    const sessions = ref([{ sessionId: "s1", aggregateVersion: 2, generation: 10, loaded: false }]);
    const pending = deferred();
    const getSessionDetailApi = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(detailResponse(document(2, 11)))
      .mockResolvedValueOnce(detailResponse(document(2, 12)));
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const old = fetchSessionDetail("s1", { source: "old" });
    const rejected = expect(old).rejects.toThrow(/version is stale/);
    sessions.value[0].generation = 11;
    const current = await fetchSessionDetail("s1", { source: "new" });
    expect(current.sessions[0].generation).toBe(11);
    pending.resolve(detailResponse(document(2, 10)));
    await rejected;
    expect(await fetchSessionDetail("s1", { source: "cache", reuseRecentlyLoaded: true })).toBe(
      current,
    );
    sessions.value[0].generation = 12;
    expect(
      (await fetchSessionDetail("s1", { source: "advanced", reuseRecentlyLoaded: true }))
        .sessions[0].generation,
    ).toBe(12);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(3);
    expect(sessions.value[0].aggregateVersion).toBe(2);
  });

  it("a superseded request cannot clear a newer pending request or return stale facts", async () => {
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
    ]);
    const oldRequest = deferred();
    const newRequest = deferred();
    const getSessionDetailApi = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const old = fetchSessionDetail("s1", { source: "old" });
    const rejected = expect(old).rejects.toThrow(/version is stale/);
    sessions.value[0].aggregateVersion = 5;
    const current = fetchSessionDetail("s1", { source: "current", requireFresh: true });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
    oldRequest.resolve(detailResponse(document(2)));
    await rejected;
    const joined = fetchSessionDetail("s1", { source: "joined", requireFresh: true });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
    newRequest.resolve(detailResponse(document(5)));
    const [left, right] = await Promise.all([current, joined]);
    expect(left).toBe(right);
    expect(left.sessions[0].aggregateVersion).toBe(5);
  });

  it("an older response cannot replace a newer recent response", async () => {
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
    ]);
    const oldRequest = deferred();
    const getSessionDetailApi = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(detailResponse(document(5)));
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const old = fetchSessionDetail("s1", { source: "old" });
    const rejected = expect(old).rejects.toThrow(/version is stale/);
    sessions.value[0].aggregateVersion = 5;
    const current = await fetchSessionDetail("s1", { source: "current" });
    oldRequest.resolve(detailResponse(document(2)));
    await rejected;
    expect(
      await fetchSessionDetail("s1", {
        source: "cached",
        reuseRecentlyLoaded: true,
      }),
    ).toBe(current);
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached facts for a recreated session with the same identifier", async () => {
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
    ]);
    const getSessionDetailApi = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(document(2)))
      .mockResolvedValueOnce(detailResponse(document(3)));
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    await fetchSessionDetail("s1", { source: "original" });
    sessions.value[0] = { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false };
    const result = await fetchSessionDetail("s1", {
      source: "recreated",
      reuseRecentlyLoaded: true,
    });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
    expect(result.sessions[0].aggregateVersion).toBe(3);
  });

  it.each(["removed", "recreated"])(
    "rejects a pending response after its session is %s",
    async (change) => {
      const sessions = ref([
        { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
      ]);
      const oldRequest = deferred();
      const newRequest = deferred();
      const getSessionDetailApi = vi
        .fn()
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(newRequest.promise);
      const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
      const old = fetchSessionDetail("s1", { source: "original" });
      const rejected = expect(old).rejects.toThrow(/request target changed/);
      sessions.value.splice(0);
      if (change === "recreated") {
        sessions.value.push({
          sessionId: "s1",
          aggregateVersion: 2,
          generation: null,
          loaded: false,
        });
      }
      const current = fetchSessionDetail("s1", { source: "current" });
      expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
      oldRequest.resolve(detailResponse(document(2)));
      await rejected;
      newRequest.resolve(detailResponse(document(5)));
      expect((await current).sessions[0].aggregateVersion).toBe(5);
    },
  );

  it("fetches message facts after the known server version advances", async () => {
    const previous = document(2);
    const sessions = ref([
      {
        sessionId: "s1",
        aggregateVersion: 3,
        generation: 10,
        isLocal: false,
        loaded: true,
        sessionDocs: previous.sessions,
      },
    ]);
    const getSessionDetailApi = vi.fn().mockResolvedValue(detailResponse(document(3)));
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const result = await fetchSessionDetail("s1", {
      source: "selectSession",
      allowLoadedSnapshot: true,
    });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(1);
    expect(result.sessions[0].aggregateVersion).toBe(3);
    expect(sessions.value[0].sessionDocs[0].aggregateVersion).toBe(2);
  });

  it("does not reuse a recent response after a conflict advances the known version", async () => {
    const sessions = ref([
      { sessionId: "s1", aggregateVersion: 2, generation: null, loaded: false },
    ]);
    const getSessionDetailApi = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(document(2)))
      .mockResolvedValueOnce(detailResponse(document(5)));
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    await fetchSessionDetail("s1", { source: "first" });
    sessions.value[0].aggregateVersion = 5;
    const result = await fetchSessionDetail("s1", {
      source: "afterConflict",
      reuseRecentlyLoaded: true,
    });
    expect(getSessionDetailApi).toHaveBeenCalledTimes(2);
    expect(result.sessions[0].aggregateVersion).toBe(5);
  });

  it("reuses a loaded document only while its own version is current", async () => {
    const current = document(3);
    const sessions = ref([
      {
        sessionId: "s1",
        aggregateVersion: 3,
        generation: 10,
        isLocal: false,
        loaded: true,
        sessionDocs: current.sessions,
      },
    ]);
    const getSessionDetailApi = vi.fn();
    const { fetchSessionDetail } = createRequests({ sessions, getSessionDetailApi });
    const result = await fetchSessionDetail("s1", {
      source: "selectSession",
      allowLoadedSnapshot: true,
    });
    expect(result.sessions[0].aggregateVersion).toBe(3);
    expect(getSessionDetailApi).not.toHaveBeenCalled();
  });
});
