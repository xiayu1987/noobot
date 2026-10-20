/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildLogWebSocketUrl,
  getSessionExecutionReportApi,
  renameSessionApi,
} from "../../../../src/infrastructure/api/chat/chatApi.js";

describe("renameSessionApi", () => {
  it("posts trimmed title to rename endpoint with provided fetcher", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    const result = await renameSessionApi(
      { userId: "u 1", sessionId: "s/1", title: "  New title  " },
      { fetcher },
    );

    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/internal/session/u%201/s%2F1/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });
  });
});

describe("buildLogWebSocketUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds agent-proxy log websocket url with api key", () => {
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:5173" } });

    expect(buildLogWebSocketUrl({ apiKey: "key 1" })).toBe(
      "ws://localhost:5173/api/logs/ws?apikey=key%201",
    );
  });

  it("uses wss when current page is https", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", host: "chat.example.test" } });

    expect(buildLogWebSocketUrl({ apiKey: "secure key" })).toBe(
      "wss://chat.example.test/api/logs/ws?apikey=secure%20key",
    );
  });
});

describe("getSessionExecutionReportApi", () => {
  const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "dp-1" };

  it("returns the decoded payload on success", async () => {
    const payload = { ok: true, report: { status: "completed" } };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload });
    await expect(getSessionExecutionReportApi(identity, { fetcher })).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/internal/session/u1/s1/execution-report?dialogProcessId=dp-1",
    );
  });

  it("keeps server error, status and errorCode on failure", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: "scope conflict", errorCode: "SCOPE_CONFLICT" }),
    });
    await expect(getSessionExecutionReportApi(identity, { fetcher })).rejects.toMatchObject({
      message: "scope conflict",
      status: 409,
      errorCode: "SCOPE_CONFLICT",
    });
  });

  it("keeps the HTTP status when the error body is not JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(getSessionExecutionReportApi(identity, { fetcher })).rejects.toMatchObject({
      message: "execution_report_failed",
      status: 502,
      errorCode: "",
    });
  });
});
