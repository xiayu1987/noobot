/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_REQUEST_ERROR_CODE, isApiRequestError } from "@noobot/shared/request-error";

import { configureAuthenticatedFetcher } from "../../../../src/infrastructure/http/authenticatedHttpService.js";

const getSessionThinkingDetailApi = vi.fn();
const fetcher = vi.fn();
vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionThinkingDetailApi: (...args) => getSessionThinkingDetailApi(...args),
}));

const { thinkingDetailService } =
  await import("../../../../src/infrastructure/api/thinking/thinkingDetailService.js");

const TARGET = Object.freeze({
  userId: "u1",
  sessionId: "s1",
  dialogProcessId: "dp-1",
  turnScopeId: "t1",
});

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function captureError() {
  return thinkingDetailService.getDetail(TARGET).catch((caught) => caught);
}

describe("thinkingDetailService.getDetail", () => {
  beforeEach(() => {
    getSessionThinkingDetailApi.mockReset();
    configureAuthenticatedFetcher(fetcher);
  });

  it("returns the payload through the configured fetcher when the detail exists", async () => {
    const payload = { ok: true, exists: true, detail: { a: 1 } };
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse(payload));
    await expect(thinkingDetailService.getDetail(TARGET)).resolves.toEqual(payload);
    expect(getSessionThinkingDetailApi).toHaveBeenCalledWith(TARGET, { fetcher });
  });

  it("raises an http ApiRequestError carrying the failure envelope", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(
      jsonResponse({ ok: false, error: "denied", errorCode: "FORBIDDEN" }, { status: 403 }),
    );
    const error = await captureError();
    expect(isApiRequestError(error)).toBe(true);
    expect(error.code).toBe(API_REQUEST_ERROR_CODE.HTTP);
    expect(error.status).toBe(403);
    expect(error.message).toBe("denied");
    expect(error.serverErrorCode).toBe("FORBIDDEN");
  });

  it("treats a 2xx body without ok:true as a contract violation", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({ ok: false, error: "denied" }));
    const error = await captureError();
    expect(error).toBeInstanceOf(TypeError);
    expect(isApiRequestError(error)).toBe(false);
  });

  it("raises a not_found ApiRequestError when the detail does not exist", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse({ ok: true, exists: false }));
    const error = await captureError();
    expect(error.code).toBe(API_REQUEST_ERROR_CODE.NOT_FOUND);
    expect(error.status).toBe(200);
  });

  it("treats a missing response as a contract violation", async () => {
    getSessionThinkingDetailApi.mockResolvedValue(null);
    const error = await captureError();
    expect(error).toBeInstanceOf(TypeError);
    expect(isApiRequestError(error)).toBe(false);
  });
});
