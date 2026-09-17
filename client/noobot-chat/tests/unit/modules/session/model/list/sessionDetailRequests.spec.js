/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createSessionDetailRequests } from "../../../../../../src/modules/session/model/list/sessionDetailRequests.js";
import {
  __resetThinkingDetailCacheForTests,
  loadThinkingDetail,
} from "../../../../../../src/modules/chat/model/thinkingDetailCache.js";

function response(payload) {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => payload),
  };
}

function createRequests(getSessionThinkingDetailApi) {
  return createSessionDetailRequests({
    sessions: ref([]),
    activeSessionId: ref(""),
    userId: ref("admin"),
    authFetch: vi.fn(),
    getSessionDetailApi: vi.fn(),
    getSessionThinkingDetailApi,
    applySessionDetail: vi.fn(),
    isSameSessionIdentity: (left, right) => left === right,
    translate: (key) => key,
  });
}

describe("sessionDetailRequests thinking detail", () => {
  afterEach(() => {
    __resetThinkingDetailCacheForTests();
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
    const getSessionThinkingDetailApi = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, exists: false }))
      .mockResolvedValueOnce(response(detailPayload));
    const { fetchThinkingDetail } = createRequests(getSessionThinkingDetailApi);

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
    expect(detail).toEqual(detailPayload);
  });
});
