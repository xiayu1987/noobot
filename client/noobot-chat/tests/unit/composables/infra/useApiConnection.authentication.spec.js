/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectApi } from "../../../../src/services/api/chatApi.js";
import { useApiConnection } from "../../../../src/composables/infra/useApiConnection.js";

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

  it("clears authentication when the retried request still returns 401", async () => {
    connectApi.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, apiKey: "rejected-fresh-key", role: "super_admin" }),
    });
    const fetchMock = vi.fn(async () => ({ status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const connection = useApiConnection({ userId: ref("admin") });

    const response = await connection.authFetch("/api/still-unauthorized");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(connectApi).toHaveBeenCalledTimes(1);
    expect(connection.apiKey.value).toBe("");
    expect(connection.connected.value).toBe(false);
    expect(localStorage.getItem("noobot_api_key")).toBe(null);
  });

  it("keeps foreground initialization when it joins a background credential refresh", async () => {
    let resolveConnect;
    connectApi.mockImplementation(() => new Promise((resolve) => {
      resolveConnect = resolve;
    }));
    const onConnected = vi.fn(async () => {});
    const connection = useApiConnection({ userId: ref("admin"), onConnected });

    const backgroundRefresh = connection.refreshAuthentication();
    const foregroundConnect = connection.connectBackend({ silent: true, runConnected: true });
    expect(connection.connecting.value).toBe(true);
    expect(connectApi).toHaveBeenCalledTimes(1);

    resolveConnect({
      ok: true,
      json: async () => ({ ok: true, apiKey: "shared-fresh-key", role: "super_admin" }),
    });

    await expect(backgroundRefresh).resolves.toBe(true);
    await expect(foregroundConnect).resolves.toBe(true);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(connection.apiKey.value).toBe("shared-fresh-key");
    expect(connection.connecting.value).toBe(false);
  });

  it("runs concurrent foreground initialization only once", async () => {
    connectApi.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, apiKey: "fresh-key", role: "super_admin" }),
    });
    let releaseConnected;
    const onConnected = vi.fn(() => new Promise((resolve) => {
      releaseConnected = resolve;
    }));
    const connection = useApiConnection({ userId: ref("admin"), onConnected });

    const first = connection.connectBackend({ silent: true });
    const second = connection.connectBackend({ silent: true });
    await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(connectApi).toHaveBeenCalledTimes(1);

    releaseConnected();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
