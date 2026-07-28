/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveHookClientEmitter(ctx = {}) {
  if (typeof ctx?.emitHookClientEvent === "function") {
    return (event, data) => ctx.emitHookClientEvent(event, data);
  }
  return null;
}
