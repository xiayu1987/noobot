/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isObjectLike } from "@noobot/shared/value";
export function resolveToolHookMeta(configuredMeta = null, fallbackMeta = {}) {
  const runtimeMeta = configuredMeta && typeof configuredMeta === "object" ? configuredMeta : null;
  if (isObjectLike(runtimeMeta?.harness)) return runtimeMeta;
  return fallbackMeta && typeof fallbackMeta === "object" ? fallbackMeta : {};
}
