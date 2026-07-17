/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import { buildLogWebSocketUrl, renameSessionApi } from "../../../../src/services/api/chatApi.js";

describe("renameSessionApi", () => {
  it("posts trimmed title to rename endpoint with provided fetcher", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    const result = await renameSessionApi(
      { userId: "u 1", sessionId: "s/1", title: "  New title  " },
      { fetcher },
    );

    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/internal/session/u%201/s%2F1/rename",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New title" }),
      },
    );
  });
});

describe("buildLogWebSocketUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds agent-proxy log websocket url with api key", () => {
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:5173" } });

    expect(buildLogWebSocketUrl({ apiKey: "key 1" })).toBe("ws://localhost:5173/api/logs/ws?apikey=key%201");
  });

  it("uses wss when current page is https", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", host: "chat.example.test" } });

    expect(buildLogWebSocketUrl({ apiKey: "secure key" })).toBe(
      "wss://chat.example.test/api/logs/ws?apikey=secure%20key",
    );
  });
});
