/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedHttpService,
  createScopedAuthenticatedHttpService,
} from "../../../src/infrastructure/http/authenticatedHttpService.js";

describe("scoped authenticated HTTP service", () => {
  const fetcher = vi.fn();

  beforeEach(() => {
    fetcher.mockReset();
    authenticatedHttpService.configure({ fetcher });
  });

  it("allows a declared same-origin GET route and preserves query parameters", async () => {
    fetcher.mockResolvedValue({ ok: true });
    const service = createScopedAuthenticatedHttpService({
      routePatterns: ["/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId"],
    });

    await service.get("/api/internal/workflow/session/admin/session-1/node-1?detail=1");

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
      routePatterns: ["/api/internal/workflow/session/:userId/:sessionId/:nodeDialogProcessId"],
    });

    expect(() => service.get(url)).toThrow("authenticated HTTP route is not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores manifest patterns outside the internal API namespace", () => {
    const service = createScopedAuthenticatedHttpService({ routePatterns: ["/:path"] });

    expect(() => service.get("/api/internal/anything")).toThrow(
      "authenticated HTTP route is not allowed",
    );
  });

  it("fails closed when the host fetcher is unavailable", () => {
    authenticatedHttpService.configure({ fetcher: null });
    const service = createScopedAuthenticatedHttpService({
      routePatterns: ["/api/internal/session/:userId/:sessionId/thinking-detail"],
    });

    expect(() => service.get("/api/internal/session/admin/s/thinking-detail")).toThrow(
      "authenticated HTTP service is unavailable",
    );
  });
});
