/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// Upper bound for the client's admission backoff during connect and session
// restore (client caps each wait at 60s, 3 retries per request).
export const ADMISSION_RETRY_BUDGET_MS = 240000;

export function admissionRetryDelayMs(response, payload = {}) {
  const retryAfterSeconds = Number(
    response.headers()["retry-after"] || payload?.retryAfterSeconds || 1,
  );
  return Math.max(1000, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000);
}
