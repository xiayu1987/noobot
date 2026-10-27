/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isFunction } from "@noobot/shared/value";

let authenticatedFetcher = null;

function compileRoutePattern(definition = {}) {
  const method = text(definition?.method).toUpperCase();
  const path = text(definition?.path);
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

export function createScopedAuthenticatedHttpService({ routePatterns = [] } = {}) {
  const allowedRoutes = routePatterns.map(compileRoutePattern).filter(Boolean);
  return Object.freeze({
    request(url = "", options = {}) {
      const fetcher = requireAuthenticatedFetcher();
      const parsed = new URL(String(url || ""), window.location.origin);
      const method = text(options?.method).toUpperCase();
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
      return fetcher(`${parsed.pathname}${parsed.search}`, { ...options, method });
    },
  });
}

export function configureAuthenticatedFetcher(fetcher) {
  if (!isFunction(fetcher)) throw new Error("authenticated fetcher must be a function");
  authenticatedFetcher = fetcher;
}

export function requireAuthenticatedFetcher() {
  if (!isFunction(authenticatedFetcher)) {
    throw new Error("authenticated HTTP service is unavailable");
  }
  return authenticatedFetcher;
}
