/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
let authenticatedFetcher = null;

function compileRoutePattern(pattern = "") {
  const segments = String(pattern || "").split("/").filter(Boolean);
  if (!segments.length || !String(pattern).startsWith("/api/internal/")) return null;
  return segments.map((segment) => segment.startsWith(":") ? null : segment);
}

function matchesRoute(pathname = "", pattern = []) {
  const segments = String(pathname || "").split("/").filter(Boolean);
  return segments.length === pattern.length
    && pattern.every((expected, index) => expected === null || expected === segments[index]);
}

/** Creates a least-privilege authenticated request capability for one plugin. */
export function createScopedAuthenticatedHttpService({ routePatterns = [] } = {}) {
  const allowedRoutes = routePatterns.map(compileRoutePattern).filter(Boolean);
  return Object.freeze({
    get(url = "") {
      if (typeof authenticatedFetcher !== "function") {
        throw new Error("authenticated HTTP service is unavailable");
      }
      const parsed = new URL(String(url || ""), window.location.origin);
      if (parsed.origin !== window.location.origin
        || !allowedRoutes.some((pattern) => matchesRoute(parsed.pathname, pattern))) {
        throw new Error(`authenticated HTTP route is not allowed: ${parsed.pathname}`);
      }
      return authenticatedFetcher(`${parsed.pathname}${parsed.search}`, { method: "GET" });
    },
  });
}

/** Host configuration only; never expose this unrestricted service to plugins. */
export const authenticatedHttpService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
});
