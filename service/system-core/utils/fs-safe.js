/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

export function safeJoin(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(base, target);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    throw new Error(`Path out of scope: ${target}`);
  }
  return resolvedTarget;
}
