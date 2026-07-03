import { describe, expect, it, vi } from "vitest";

import { renameSessionApi } from "../../../../src/services/api/chatApi.js";

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
