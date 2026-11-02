/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireHookTurn(context) {
  const turn = context.turn;
  if (!Number.isSafeInteger(turn) || turn < 1) {
    throw new TypeError("hook context requires a positive integer turn");
  }
  return turn;
}
