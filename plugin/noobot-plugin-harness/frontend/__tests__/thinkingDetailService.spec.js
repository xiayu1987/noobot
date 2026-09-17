/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createThinkingDetailService } from "../services/thinkingDetailService.js";

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn(async () => payload),
  };
}

describe("Harness thinking detail service", () => {
  it("parses the authenticated response before returning thinking detail", async () => {
    const payload = {
      ok: true,
      exists: true,
      messageItem: { role: "assistant", thinkingContentTimeline: [] },
    };
    const authenticatedRequest = vi.fn(async () => response(payload));
    const service = createThinkingDetailService(authenticatedRequest);

    await expect(
      service.getDetail({
        userId: "admin/user",
        sessionId: "session 1",
        dialogProcessId: "dialog-1",
        turnScopeId: "client-turn:1",
      }),
    ).resolves.toEqual(payload);
    expect(authenticatedRequest).toHaveBeenCalledWith(
      "/api/internal/session/admin%2Fuser/session%201/thinking-detail?dialogProcessId=dialog-1&turnScopeId=client-turn%3A1",
      { method: "GET" },
    );
  });

  it("marks an eventually consistent missing detail as retryable", async () => {
    const service = createThinkingDetailService(
      vi.fn(async () => response({ ok: true, exists: false })),
    );

    await expect(
      service.getDetail({
        userId: "admin",
        sessionId: "session-1",
        turnScopeId: "client-turn:1",
      }),
    ).rejects.toMatchObject({ code: "thinking_detail_not_found" });
  });
});
