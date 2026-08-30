/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedHttpService,
  createScopedAuthenticatedHttpService,
} from "../../../../src/infrastructure/http/authenticatedHttpService.js";

describe("scoped authenticated HTTP service", () => {
  const fetcher = vi.fn();

  beforeEach(() => {
    fetcher.mockReset();
    authenticatedHttpService.configure({ fetcher });
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

  it("fails closed when the host fetcher is unavailable", () => {
    authenticatedHttpService.configure({ fetcher: null });
    const service = createScopedAuthenticatedHttpService({
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
