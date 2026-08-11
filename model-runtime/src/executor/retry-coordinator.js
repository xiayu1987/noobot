/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { shouldRetryTransport } from "../policies/default-retry-policy.js";
export async function executeTransportRetry({ run, classify, policy, clock, observe }) {
  let last;
  const maxAttempts = Math.max(1, Number(policy?.maxAttempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { value: await run(attempt), attemptCount: attempt };
    } catch (error) {
      last = error;
      const classification = classify(error);
      if (
        !shouldRetryTransport({
          classification,
          attempt,
          maxAttempts,
          streamedTokens: error?.streamedTokens || 0,
        })
      )
        throw error;
      const delayMs = Math.max(0, Number(policy?.baseDelayMs) || 0) * attempt;
      observe?.("model.invocation.retry_scheduled", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        classification,
      });
      await clock.sleep(delayMs);
    }
  }
  throw last;
}
