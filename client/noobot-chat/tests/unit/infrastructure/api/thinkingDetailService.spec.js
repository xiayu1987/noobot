/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionThinkingDetailApi = vi.fn();
vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionThinkingDetailApi: (...args) => getSessionThinkingDetailApi(...args),
}));

const { thinkingDetailService } =
  await import("../../../../src/infrastructure/api/thinking/thinkingDetailService.js");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

describe("thinkingDetailService.getDetail", () => {
  beforeEach(() => {
    getSessionThinkingDetailApi.mockReset();
    thinkingDetailService.configure({ fetcher: null });
  });

  it("returns payload when the detail exists", async () => {
    const payload = { ok: true, exists: true, detail: { a: 1 } };
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse(payload));
    await expect(thinkingDetailService.getDetail({ sessionId: "s1" })).resolves.toEqual(payload);
    expect(getSessionThinkingDetailApi).toHaveBeenCalledWith(
      { userId: "", sessionId: "s1", dialogProcessId: "", turnScopeId: "" },
      {},
    );
  });

  it("passes the configured fetcher through", async () => {
    const fetcher = vi.fn();
    thinkingDetailService.configure({ fetcher });
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({ ok: true, exists: true }));
    await thinkingDetailService.getDetail();
    expect(getSessionThinkingDetailApi.mock.calls[0][1]).toEqual({ fetcher });
  });

  it("throws with the HTTP status when the response is not ok", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));
    await expect(thinkingDetailService.getDetail()).rejects.toThrow(
      "failed to load thinking detail: 404",
    );
  });

  it("falls back to status 500 when there is no response", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(null);
    await expect(thinkingDetailService.getDetail()).rejects.toThrow(
      "failed to load thinking detail: 500",
    );
  });

  it("marks missing details with thinking_detail_not_found", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({ ok: true, exists: false }));
    const error = await thinkingDetailService.getDetail().catch((caught) => caught);
    expect(error.message).toBe("thinking detail not found");
    expect(error.code).toBe("thinking_detail_not_found");
  });

  it("surfaces the server error without a code when ok is false", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({ ok: false, error: "denied" }));
    const error = await thinkingDetailService.getDetail().catch((caught) => caught);
    expect(error.message).toBe("denied");
    expect(error.code).toBeUndefined();
  });

  it("treats an empty JSON body as not found without a code", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse(null));
    const error = await thinkingDetailService.getDetail().catch((caught) => caught);
    expect(error.message).toBe("thinking detail not found");
    expect(error.code).toBeUndefined();
  });
});
