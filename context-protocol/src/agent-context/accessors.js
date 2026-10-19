/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "@noobot/shared/value";

export function getAgentContextIdentity(context) {
  if (!isPlainObject(context) || !isPlainObject(context.identity)) {
    throw new TypeError("agent context identity is required");
  }
  return { ...context.identity };
}
