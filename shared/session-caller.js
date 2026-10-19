/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SESSION_CALLER = Object.freeze({
  USER: "user",
  BOT: "bot",
});

const SESSION_CALLERS = new Set(Object.values(SESSION_CALLER));

export function isSessionCaller(value) {
  return SESSION_CALLERS.has(value);
}

export function requireSessionCaller(value) {
  if (isSessionCaller(value)) return value;
  const error = new TypeError(`session caller must be one of ${[...SESSION_CALLERS].join("|")}`);
  error.code = "SESSION_CALLER_INVALID";
  error.details = { caller: value };
  throw error;
}
