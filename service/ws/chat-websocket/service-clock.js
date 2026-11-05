/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Service wall clock in epoch milliseconds, derived from the single session clock
 * (`bot.session.readServerNow()`), so recovery observations share the `serverNow` time domain.
 */
export function readServiceClockMs(bot) {
  const serverNow = bot.session.readServerNow();
  const ms = Date.parse(serverNow);
  if (!Number.isSafeInteger(ms)) {
    throw new TypeError(`service clock returned a non-canonical timestamp: ${String(serverNow)}`);
  }
  return ms;
}
