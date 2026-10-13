/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function reportRuntimeEventFailure(kind, context = {}, error = null) {
  console.warn(`[runtime-events] ${kind}`, context, error);
}
