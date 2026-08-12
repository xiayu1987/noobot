/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const DEFAULT_RETRY_POLICY = Object.freeze({
  transport: Object.freeze({ maxAttempts: 3, baseDelayMs: 250 }),
  reasoningOnly: Object.freeze({ maxAttempts: 1 }),
  toolCallMismatch: Object.freeze({ maxAttempts: 1, downgradeStreaming: true }),
  providerFallback: Object.freeze({ enabled: false, candidates: Object.freeze([]) }),
});

function normalizeAttemptPolicy(defaults, input) {
  const source = input && typeof input === "object" ? input : {};
  const maxAttempts = Number(source.maxAttempts ?? defaults.maxAttempts);
  return Object.freeze({
    ...defaults,
    ...source,
    maxAttempts: Number.isFinite(maxAttempts)
      ? Math.max(1, Math.floor(maxAttempts))
      : defaults.maxAttempts,
  });
}

export function normalizeRetryPolicy(input = {}) {
  return Object.freeze({
    transport: normalizeAttemptPolicy(DEFAULT_RETRY_POLICY.transport, input.transport),
    reasoningOnly: normalizeAttemptPolicy(DEFAULT_RETRY_POLICY.reasoningOnly, input.reasoningOnly),
    toolCallMismatch: normalizeAttemptPolicy(
      DEFAULT_RETRY_POLICY.toolCallMismatch,
      input.toolCallMismatch,
    ),
    providerFallback: Object.freeze({
      ...DEFAULT_RETRY_POLICY.providerFallback,
      ...(input.providerFallback && typeof input.providerFallback === "object"
        ? input.providerFallback
        : {}),
    }),
  });
}
