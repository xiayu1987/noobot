/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveToolHookMeta(configuredMeta = null, fallbackMeta = {}) {
  const runtimeMeta = configuredMeta && typeof configuredMeta === "object" ? configuredMeta : null;
  if (runtimeMeta?.harness && typeof runtimeMeta.harness === "object") return runtimeMeta;
  return fallbackMeta && typeof fallbackMeta === "object" ? fallbackMeta : {};
}

