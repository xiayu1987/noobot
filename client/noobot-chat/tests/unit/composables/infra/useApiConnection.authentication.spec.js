/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectApi } from "../../../../src/services/api/chatApi";
import { useApiConnection } from "../../../../src/composables/infra/useApiConnection";

vi.mock("../../../../src/services/api/chatApi", () => ({ connectApi: vi.fn() }));
vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({ translate: (key) => key, locale: ref("zh-CN") }),
}));

describe("useApiConnection authentication recovery", () => {
  beforeEach(() => {
    const values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    });
    localStorage.clear();
    localStorage.setItem("noobot_connect_code", "connect-code");
    localStorage.setItem("noobot_api_key", "stale-key");
    localStorage.setItem("noobot_api_user_id", "admin");
    vi.clearAllMocks();
  });

  it("single-flights credential refresh and retries concurrent 401 requests once", async () => {
    connectApi.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, apiKey: "fresh-key", role: "super_admin" }),
    });
    const fetchMock = vi.fn(async (_url, options = {}) => ({
      status: options.headers?.["x-api-key"] === "fresh-key" ? 200 : 401,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const connection = useApiConnection({ userId: ref("admin") });

    const [first, second] = await Promise.all([
      connection.authFetch("/api/first"),
      connection.authFetch("/api/second"),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(connectApi).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(connection.apiKey.value).toBe("fresh-key");
  });

  it("preserves the current credential when background recovery races service downtime", async () => {
    connectApi.mockRejectedValue(new Error("service unavailable"));
    const connection = useApiConnection({ userId: ref("admin") });

    await expect(connection.refreshAuthentication()).resolves.toBe(false);

    expect(connection.apiKey.value).toBe("stale-key");
    expect(connection.connected.value).toBe(true);
  });
});
