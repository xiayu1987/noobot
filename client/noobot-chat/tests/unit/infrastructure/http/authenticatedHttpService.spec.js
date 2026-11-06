/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureAuthenticatedFetcher,
  authenticatedResourceAccess,
  createScopedAuthenticatedHttpService,
} from "../../../../src/infrastructure/http/authenticatedHttpService.js";

describe("scoped authenticated HTTP service", () => {
  const fetcher = vi.fn();

  beforeEach(() => {
    fetcher.mockReset();
    configureAuthenticatedFetcher(fetcher);
  });

  it("allows a declared same-origin GET route and preserves query parameters", async () => {
    fetcher.mockResolvedValue({ ok: true });
    const service = createScopedAuthenticatedHttpService({
      routePatterns: [
        {
          method: "GET",
          path: "/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId",
        },
      ],
    });

    await service.request("/api/internal/workflow/session/admin/session-1/node-1?detail=1", {
      method: "GET",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/internal/workflow/session/admin/session-1/node-1?detail=1",
      { method: "GET" },
    );
  });

  it.each([
    ["cross-origin", "https://example.com/api/internal/workflow/session/admin/s/n"],
    ["undeclared route", "/api/internal/workflow/session/admin/s/n/thinking-detail"],
    ["other plugin route", "/api/internal/session/admin/s/thinking-detail"],
    ["segment suffix", "/api/internal/workflow/session/admin/s/n/extra"],
  ])("rejects %s", (_label, url) => {
    const service = createScopedAuthenticatedHttpService({
      routePatterns: [
        {
          method: "GET",
          path: "/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId",
        },
      ],
    });

    expect(() => service.request(url, { method: "GET" })).toThrow(
      "authenticated HTTP route is not allowed",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores manifest patterns outside the internal API namespace", () => {
    const service = createScopedAuthenticatedHttpService({
      routePatterns: [{ method: "GET", path: "/:path" }],
    });

    expect(() => service.request("/api/internal/anything", { method: "GET" })).toThrow(
      "authenticated HTTP route is not allowed",
    );
  });

  it("fails closed when the host fetcher is unavailable", async () => {
    vi.resetModules();
    const unconfigured =
      await import("../../../../src/infrastructure/http/authenticatedHttpService.js");
    const service = unconfigured.createScopedAuthenticatedHttpService({
      routePatterns: [
        {
          method: "GET",
          path: "/api/internal/session/:userId/:sessionId/thinking-detail",
        },
      ],
    });

    expect(() =>
      service.request("/api/internal/session/admin/s/thinking-detail", { method: "GET" }),
    ).toThrow("authenticated HTTP service is unavailable");
  });

  it("rejects configuration without a fetcher function", () => {
    expect(() => configureAuthenticatedFetcher(null)).toThrow(
      "authenticated fetcher must be a function",
    );
  });

  it("authorizes each declared method independently", async () => {
    fetcher.mockResolvedValue({ ok: true });
    const service = createScopedAuthenticatedHttpService({
      routePatterns: [{ method: "PUT", path: "/api/internal/character/assets/:assetId" }],
    });
    const body = new Blob(["glb"]);

    await service.request("/api/internal/character/assets/user.glb.1", {
      method: "PUT",
      body,
      headers: { "content-type": "model/gltf-binary" },
    });

    expect(fetcher).toHaveBeenCalledWith("/api/internal/character/assets/user.glb.1", {
      method: "PUT",
      body,
      headers: { "content-type": "model/gltf-binary" },
    });
    expect(() =>
      service.request("/api/internal/character/assets/user.glb.1", { method: "GET" }),
    ).toThrow("authenticated HTTP route is not allowed");
  });
});

it("exchanges authenticated access for a resource ticket without putting the API key in the URL", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, token: "ticket", expiresAt: Date.now() + 3600000 }),
  }));
  configureAuthenticatedFetcher(fetcher);
  expect(await authenticatedResourceAccess("/api/internal/attachment/u/a?sessionId=s")).toEqual({
    url: "/api/internal/attachment/u/a?sessionId=s&resourceToken=ticket",
    expiresAt: expect.any(Number),
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    target: "/internal/attachment/u/a?sessionId=s",
  });
  await expect(
    authenticatedResourceAccess("https://external.invalid/api/internal/a"),
  ).rejects.toThrow("same-origin");
  await expect(authenticatedResourceAccess("/public/file")).rejects.toThrow("internal");
  fetcher.mockResolvedValueOnce({ ok: false, status: 401 });
  await expect(authenticatedResourceAccess("/api/internal/attachment/u/a")).rejects.toThrow(
    "HTTP 401",
  );
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  await expect(authenticatedResourceAccess("/api/internal/attachment/u/a")).rejects.toThrow(
    "Invalid resource authorization response",
  );
});
