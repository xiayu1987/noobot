/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

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

function createRequests() {
  return createSessionDetailRequests({
    sessions: ref([]),
    activeSessionId: ref(""),
    userId: ref("admin"),
    authFetch: vi.fn(),
    getSessionDetailApi: vi.fn(),
    isSameSessionIdentity: (left, right) => left === right,
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
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
      },
      fetchThinkingDetail,
      retryLimit: 1,
      retryDelayMs: 0,
    });

    expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(2);
    expect(getSessionThinkingDetailApi.mock.calls[0][0]).toEqual({
      userId: "admin",
      sessionId: "session-eventual-detail",
      dialogProcessId: "",
      turnScopeId: "client-turn:eventual-detail",
    });
    expect(detail).toEqual(detailPayload);
  });

  it("passes the server failure envelope through unchanged", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(
      response({ ok: false, error: "denied" }, { status: 503 }),
    );
    const { fetchThinkingDetail } = createRequests();

    const error = await fetchThinkingDetail({ sessionId: "s1", turnScopeId: "t1" }).catch(
      (caught) => caught,
    );
    expect(error.code).toBe("http");
    expect(error.status).toBe(503);
    expect(error.message).toBe("denied");
  });

  it("keeps the missing-detail code from the thinking detail service", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(response({ ok: true, exists: false }));
    const { fetchThinkingDetail } = createRequests();

    const error = await fetchThinkingDetail({ sessionId: "s1", turnScopeId: "t1" }).catch(
      (caught) => caught,
    );
    expect(error.message).toBe("thinking detail not found");
    expect(error.code).toBe("not_found");
  });

  it("requires a dialog process or turn scope identity", async () => {
    const { fetchThinkingDetail } = createRequests();

    await expect(fetchThinkingDetail({ sessionId: "s1" })).rejects.toThrow(
      "dialogProcessId or turnScopeId is required",
    );
    expect(getSessionThinkingDetailApi).not.toHaveBeenCalled();
  });
});
