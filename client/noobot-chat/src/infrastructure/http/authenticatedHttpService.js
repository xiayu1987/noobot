/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
let authenticatedFetcher = null;

function compileRoutePattern(definition = {}) {
  const method = String(definition?.method || "")
    .trim()
    .toUpperCase();
  const path = String(definition?.path || "").trim();
  const segments = path.split("/").filter(Boolean);
  if (!method || !segments.length || !path.startsWith("/api/internal/")) return null;
  return {
    method,
    segments: segments.map((segment) => (segment.startsWith(":") ? null : segment)),
  };
}

function matchesRoute(pathname = "", pattern = {}) {
  const segments = String(pathname || "")
    .split("/")
    .filter(Boolean);
  return (
    segments.length === pattern.segments.length &&
    pattern.segments.every((expected, index) => expected === null || expected === segments[index])
  );
}

/** Creates a least-privilege authenticated request capability for one plugin. */
export function createScopedAuthenticatedHttpService({ routePatterns = [] } = {}) {
  const allowedRoutes = routePatterns.map(compileRoutePattern).filter(Boolean);
  return Object.freeze({
    request(url = "", options = {}) {
      if (typeof authenticatedFetcher !== "function") {
        throw new Error("authenticated HTTP service is unavailable");
      }
      const parsed = new URL(String(url || ""), window.location.origin);
      const method = String(options?.method || "")
        .trim()
        .toUpperCase();
      if (
        parsed.origin !== window.location.origin ||
        !allowedRoutes.some(
          (pattern) => pattern.method === method && matchesRoute(parsed.pathname, pattern),
        )
      ) {
        throw new Error(
          `authenticated HTTP route is not allowed: ${method || "<missing>"} ${parsed.pathname}`,
        );
      }
      return authenticatedFetcher(`${parsed.pathname}${parsed.search}`, { ...options, method });
    },
  });
}

/** Host configuration only; never expose this unrestricted service to plugins. */
export const authenticatedHttpService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
});
