/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function resolveContextObject(options = {}) {
  const ctx = options?.context;
  return ctx && typeof ctx === "object" && !Array.isArray(ctx) ? ctx : {};
}

export function normalizeParentSessionId(input = "") {
  return String(input || "").trim().slice(0, 200);
}

export function resolveParentSessionIdWithMeta(options = {}) {
  const context = resolveContextObject(options);
  const contextRuntime =
    context?.runtime && typeof context.runtime === "object" ? context.runtime : {};
  const candidates = [
    { source: "context.parentSessionId", value: context?.parentSessionId },
    { source: "options.parentSessionId", value: options?.parentSessionId },
    {
      source: "context.runtime.systemRuntime.parentSessionId",
      value: contextRuntime?.systemRuntime?.parentSessionId,
    },
    {
      source: "options.runtime.systemRuntime.parentSessionId",
      value: options?.runtime?.systemRuntime?.parentSessionId,
    },
  ];
  for (const item of candidates) {
    const normalizedValue = normalizeParentSessionId(item?.value);
    if (!normalizedValue) continue;
    return {
      value: normalizedValue,
      source: String(item?.source || "").trim(),
      legacy: false,
    };
  }
  return { value: "", source: "", legacy: false };
}

/**
 * Resolve parentSessionId from mixed runtime/context shapes.
 * Phase-1 goal: keep existing behavior while centralizing fallback chain.
 */
export function resolveParentSessionId(options = {}) {
  const resolved = resolveParentSessionIdWithMeta(options);
  return resolved.value;
}
