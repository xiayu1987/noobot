/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isObjectLike } from "@noobot/shared/value";

export function requireToolHookContext(config) {
  const hookContext = config?.configurable?.noobotHookContext;
  if (!isObjectLike(hookContext)) {
    throw new TypeError("harness tool requires configurable.noobotHookContext");
  }
  return hookContext;
}
