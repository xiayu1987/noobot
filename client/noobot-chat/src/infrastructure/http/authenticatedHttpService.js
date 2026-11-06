/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isFunction } from "@noobot/shared/value";
import { RESOURCE_ACCESS_ROUTE, RESOURCE_ACCESS_TOKEN_QUERY } from "@noobot/shared/resource-access";

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

export async function authenticatedResourceAccess(url, signal) {
  const parsed = new URL(url, window.location.origin);
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/internal/"))
    throw new Error("authenticated resource must use an internal same-origin route");
  const response = await requireAuthenticatedFetcher()(`/api${RESOURCE_ACCESS_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: `${parsed.pathname.slice(4)}${parsed.search}` }),
    signal,
  });
  if (!response.ok) throw new Error(`Resource authorization failed: HTTP ${response.status}`);
  const data = await response.json();
  if (
    !data.ok ||
    typeof data.token !== "string" ||
    !data.token ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= Date.now()
  )
    throw new Error("Invalid resource authorization response");
  parsed.searchParams.set(RESOURCE_ACCESS_TOKEN_QUERY, data.token);
  return { url: `${parsed.pathname}${parsed.search}`, expiresAt: data.expiresAt };
}

export function requireAuthenticatedFetcher() {
  if (!isFunction(authenticatedFetcher)) {
    throw new Error("authenticated HTTP service is unavailable");
  }
  return authenticatedFetcher;
}
