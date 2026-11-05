/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function readServiceClockMs(bot) {
  const serverNow = bot.session.readServerNow();
  const ms = Date.parse(serverNow);
  if (!Number.isSafeInteger(ms)) {
    throw new TypeError(`service clock returned a non-canonical timestamp: ${String(serverNow)}`);
  }
  return ms;
}
