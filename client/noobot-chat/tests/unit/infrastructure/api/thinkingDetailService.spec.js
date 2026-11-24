/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildThinkingDetailPayload } from "@noobot/event-protocol/thinking-detail-projection";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { API_REQUEST_ERROR_CODE, isApiRequestError } from "@noobot/shared/request-error";
import { encodeSessionPageSnapshotCursor } from "@noobot/session-protocol/message-read-budget";

import { configureAuthenticatedFetcher } from "../../../../src/infrastructure/http/authenticatedHttpService.js";

const getSessionThinkingDetailApi = vi.fn();
const releaseSessionThinkingDetailApi = vi.fn();
const fetcher = vi.fn();
vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionThinkingDetailApi: (...args) => getSessionThinkingDetailApi(...args),
  releaseSessionThinkingDetailApi: (...args) => releaseSessionThinkingDetailApi(...args),
}));

const { thinkingDetailService } =
  await import("../../../../src/infrastructure/api/thinking/thinkingDetailService.js");

const TARGET = Object.freeze({
  userId: "u1",
  sessionId: "s1",
  dialogProcessId: "dp-1",
  turnScopeId: "t1",
});

const RETAINED_CURSOR = encodeSessionPageSnapshotCursor("snapshot", { after: 1, scope: "turn" });

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function captureError() {
  return thinkingDetailService.getPage(TARGET).catch((caught) => caught);
}

function message(messageUid) {
  return {
    sessionId: TARGET.sessionId,
    dialogProcessId: TARGET.dialogProcessId,
    turnScopeId: TARGET.turnScopeId,
    messageUid,
    role: "assistant",
    presentationMessageId: "presentation",
    modelMessageId: `model-${messageUid}`,
    content: null,
    activityTimeline: [],
  };
}

function page(messages, overrides = {}) {
  return {
    ok: true,
    exists: true,
    sessionId: TARGET.sessionId,
    dialogProcessId: TARGET.dialogProcessId,
    turnScopeId: TARGET.turnScopeId,
    generation: 3,
    messageCount: messages.length,
    messages,
    nextCursor: null,
    ...overrides,
  };
}

function detail(messages, { after = 0, messageCount = messages.length, nextCursor = null } = {}) {
  return {
    ...buildThinkingDetailPayload(
      {
        ...TARGET,
        messages,
        contentRevision: JSON.stringify([TARGET.sessionId, 3, after]),
      },
      { after },
    ),
    page: { generation: 3, messageCount, after, count: messages.length, nextCursor },
  };
}

describe("thinkingDetailService.getPage", () => {
  beforeEach(() => {
    getSessionThinkingDetailApi.mockReset();
    releaseSessionThinkingDetailApi
      .mockReset()
      .mockImplementation(() => jsonResponse({ ok: true, released: true }));
    configureAuthenticatedFetcher(fetcher);
  });

  it("releases a decoded first-page cursor when projection rejects the page", async () => {
    const cursor = RETAINED_CURSOR;
    getSessionThinkingDetailApi.mockResolvedValue(
      jsonResponse(
        page([message("first")], { generation: -1, messageCount: 2, nextCursor: cursor }),
      ),
    );
    await expect(thinkingDetailService.getPage(TARGET)).rejects.toBeInstanceOf(TypeError);
    expect(releaseSessionThinkingDetailApi).toHaveBeenCalledExactlyOnceWith(
      { ...TARGET, cursor },
      { fetcher },
    );
  });

  it("preserves both the projection error and the release error", async () => {
    const nextCursor = RETAINED_CURSOR;
    const releaseError = new Error("release failed");
    releaseSessionThinkingDetailApi.mockRejectedValue(releaseError);
    getSessionThinkingDetailApi.mockResolvedValue(
      jsonResponse(page([message("first")], { generation: -1, messageCount: 2, nextCursor })),
    );
    const error = await captureError();
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.errors).toEqual([error.cause, releaseError]);
  });

  it("returns the payload through the configured fetcher when the detail exists", async () => {
    const messages = [message("first")];
    getSessionThinkingDetailApi.mockResolvedValue(jsonResponse(page(messages)));
    await expect(thinkingDetailService.getPage(TARGET)).resolves.toEqual(detail(messages));
    expect(getSessionThinkingDetailApi).toHaveBeenCalledWith(
      { ...TARGET, cursor: null, limit: QUANTITY_THRESHOLDS.sessionStorage.messageReadPageSize },
      { fetcher },
    );
  });

  it("requests and projects one bounded page at a time using the published snapshot", async () => {
    const messages = [message("first"), message("second")];
    const nextCursor = RETAINED_CURSOR;
    getSessionThinkingDetailApi
      .mockResolvedValueOnce(jsonResponse(page([messages[0]], { messageCount: 2, nextCursor })))
      .mockResolvedValueOnce(jsonResponse(page([messages[1]], { messageCount: 2 })));
    const first = await thinkingDetailService.getPage(TARGET);
    expect(first).toEqual(detail([messages[0]], { messageCount: 2, nextCursor }));
    expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(1);
    await expect(
      thinkingDetailService.getPage({ ...TARGET, cursor: nextCursor, snapshot: first.page }),
    ).resolves.toEqual(detail([messages[1]], { after: 1, messageCount: 2 }));
    expect(getSessionThinkingDetailApi.mock.calls[1][0].cursor).toEqual(nextCursor);
    expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(2);
    expect(releaseSessionThinkingDetailApi).not.toHaveBeenCalled();
  });

  it("rejects continuation without its snapshot before issuing a request", async () => {
    await expect(
      thinkingDetailService.getPage({ ...TARGET, cursor: RETAINED_CURSOR }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(getSessionThinkingDetailApi).not.toHaveBeenCalled();
  });

  it("does not send or release a continuation the previous page did not grant", async () => {
    const cursor = encodeSessionPageSnapshotCursor("foreign", { after: 1, scope: "turn" });
    await expect(
      thinkingDetailService.getPage({
        ...TARGET,
        cursor,
        snapshot: { generation: 3, messageCount: 2, nextCursor: RETAINED_CURSOR },
      }),
    ).rejects.toThrow(/previous thinking detail page/);
    expect(getSessionThinkingDetailApi).not.toHaveBeenCalled();
    expect(releaseSessionThinkingDetailApi).not.toHaveBeenCalled();
  });

  for (const invalid of [
    { generation: 4 },
    { messageCount: 3 },
    { sessionId: "foreign" },
    { messages: [] },
    { nextCursor: { after: 1, scope: "snapshot" } },
  ]) {
    it(`rejects an inconsistent or non-progressing page: ${JSON.stringify(invalid)}`, async () => {
      const nextCursor = RETAINED_CURSOR;
      getSessionThinkingDetailApi
        .mockResolvedValueOnce(
          jsonResponse(page([message("first")], { messageCount: 2, nextCursor })),
        )
        .mockResolvedValueOnce(
          jsonResponse(page([message("second")], { messageCount: 2, ...invalid })),
        );
      const first = await thinkingDetailService.getPage(TARGET);
      await expect(
        thinkingDetailService.getPage({ ...TARGET, cursor: nextCursor, snapshot: first.page }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(2);
      expect(releaseSessionThinkingDetailApi).toHaveBeenCalledExactlyOnceWith(
        { ...TARGET, cursor: nextCursor },
        { fetcher },
      );
    });
  }

  it("surfaces snapshot conflicts without requesting the full-detail endpoint or retrying", async () => {
    const nextCursor = RETAINED_CURSOR;
    getSessionThinkingDetailApi
      .mockResolvedValueOnce(
        jsonResponse(page([message("first")], { messageCount: 2, nextCursor })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { ok: false, errorCode: "SESSION_PAGE_CURSOR_CONFLICT", error: "snapshot changed" },
          { status: 409 },
        ),
      );
    const first = await thinkingDetailService.getPage(TARGET);
    await expect(
      thinkingDetailService.getPage({ ...TARGET, cursor: nextCursor, snapshot: first.page }),
    ).rejects.toMatchObject({
      serverErrorCode: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    expect(getSessionThinkingDetailApi).toHaveBeenCalledTimes(2);
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
