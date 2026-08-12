/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveApiKey(getApiKey = "") {
  return typeof getApiKey === "function"
    ? String(getApiKey() || "").trim()
    : String(getApiKey || "").trim();
}

export function createApiKeyFetch(getApiKey = "") {
  function authHeaders(extra = {}) {
    const apiKey = resolveApiKey(getApiKey);
    return {
      ...extra,
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    };
  }

  function authFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: authHeaders(options.headers || {}),
    });
  }

  return {
    authHeaders,
    authFetch,
  };
}
