/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_CONTEXT_SEQUENCE_POLICY = Object.freeze({
  CHECKPOINT_APPEND_ONLY: "checkpoint_append_only",
  INDEPENDENT_REQUEST: "independent_request",
});

const MODEL_CONTEXT_SEQUENCE_POLICIES = new Set(Object.values(MODEL_CONTEXT_SEQUENCE_POLICY));

export function requireModelContextSequencePolicy(value) {
  const normalized = String(value || "").trim();
  if (!MODEL_CONTEXT_SEQUENCE_POLICIES.has(normalized)) {
    throw new TypeError(`invalid model context sequence policy: ${normalized || "missing"}`);
  }
  return normalized;
}
