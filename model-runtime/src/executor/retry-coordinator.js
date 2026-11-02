/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_INVOCATION_EVENT } from "@noobot/model-protocol";
import { shouldRetryTransport } from "../policies/default-retry-policy.js";

export async function executeTransportRetry({
  run,
  classify,
  policy,
  clock,
  observe,
  signal = null,
  streamedTokens = () => 0,
}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await run(attempt), attemptCount: attempt };
    } catch (error) {
      await waitForRetry(error, attempt);
    }
  }

  async function waitForRetry(error, attempt) {
    if (signal?.aborted) throw error;
    const classification = classify(error);
    if (
      !shouldRetryTransport({
        classification,
        attempt,
        maxAttempts: policy.maxAttempts,
        streamedTokens: Number(streamedTokens()) || 0,
      })
    )
      throw error;
    const delayMs = policy.baseDelayMs * attempt;
    observe(MODEL_INVOCATION_EVENT.RETRY_SCHEDULED, {
      attempt,
      nextAttempt: attempt + 1,
      delayMs,
      classification,
    });
    await clock.sleep(delayMs);
    if (signal?.aborted) throw error;
  }
}
