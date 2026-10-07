/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const getSessionThinkingDetailApi = vi.fn();
vi.mock("../../../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionThinkingDetailApi: (...args) => getSessionThinkingDetailApi(...args),
}));

const { createSessionDetailRequests } =
  await import("../../../../../../src/modules/session/model/list/sessionDetailRequests.js");
const { __resetThinkingDetailCacheForTests, loadThinkingDetail } =
  await import("../../../../../../src/modules/chat/model/thinkingDetailCache.js");

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn(async () => payload),
  };
}

function createRequests() {
  return createSessionDetailRequests({
    sessions: ref([]),
    activeSessionId: ref(""),
    userId: ref("admin"),
    authFetch: vi.fn(),
    getSessionDetailApi: vi.fn(),
    applySessionDetail: vi.fn(),
    isSameSessionIdentity: (left, right) => left === right,
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
  });
}

describe("sessionDetailRequests thinking detail", () => {
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
            contentId: "message:user-interjection:command-1",
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

  it("translates HTTP failures from the shared thinking detail service", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(response({}, { ok: false, status: 503 }));
    const { fetchThinkingDetail } = createRequests();

    await expect(fetchThinkingDetail("s1", { turnScopeId: "t1" })).rejects.toThrow(
      'chat.getSessionFailed:{"status":503}',
    );
  });

  it("passes through server payload errors", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(response({ ok: false, error: "denied" }));
    const { fetchThinkingDetail } = createRequests();

    await expect(fetchThinkingDetail("s1", { turnScopeId: "t1" })).rejects.toThrow("denied");
  });

  it("keeps the missing-detail code with a localized message", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(response({ ok: true, exists: false }));
    const { fetchThinkingDetail } = createRequests();

    const error = await fetchThinkingDetail("s1", { turnScopeId: "t1" }).catch((caught) => caught);
    expect(error.message).toBe("chat.sessionNotFound");
    expect(error.code).toBe("thinking_detail_not_found");
  });

  it("requires a dialog process or turn scope identity", async () => {
    const { fetchThinkingDetail } = createRequests();

    await expect(fetchThinkingDetail("s1")).rejects.toThrow(
      "dialogProcessId or turnScopeId is required",
    );
    expect(getSessionThinkingDetailApi).not.toHaveBeenCalled();
  });
});
