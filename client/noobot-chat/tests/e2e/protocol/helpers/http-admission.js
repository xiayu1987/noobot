/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ADMISSION_RETRY_BUDGET_MS = 240000;

export function admissionRetryDelayMs(response, payload = {}) {
  const retryAfterSeconds = Number(
    response.headers()["retry-after"] || payload?.retryAfterSeconds || 1,
  );
  return Math.max(1000, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1000);
}
