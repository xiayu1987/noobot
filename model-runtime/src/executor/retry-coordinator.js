/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_INVOCATION_EVENT,
  resolveModelRetryDelay,
  resolveModelFailureRecovery,
} from "@noobot/model-protocol";
import { shouldRetryTransport } from "../policies/default-retry-policy.js";

export async function executeTransportRetry({
  run,
  classify,
  policy,
  canRetry,
  clock,
  observe,
  signal = null,
}) {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return { value: await run(attempt), attemptCount: attempt };
    } catch (error) {
      await waitForRetry(error, attempt);
    }
  }

  async function waitForRetry(error, attempt) {
    if (signal?.aborted || !canRetry()) throw error;
    const classification = classify(error);
    if (!shouldRetryTransport({ classification, attempt, maxAttempts: policy.maxAttempts }))
      throw error;
    const delayMs = resolveModelRetryDelay({
      attempt,
      baseDelayMs: policy.baseDelayMs,
      retryAfterMs: classification.retryAfterMs,
    });
    await observe(MODEL_INVOCATION_EVENT.RETRY_SCHEDULED, {
      attempt,
      nextAttempt: attempt + 1,
      delayMs,
      classification,
      recovery: resolveModelFailureRecovery(classification),
    });
    await clock.sleep(delayMs, { signal });
    signal?.throwIfAborted();
  }
}
