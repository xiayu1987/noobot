/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeLoggerAdapter(adapter = {}, fallback = {}) {
  const source = adapter && typeof adapter === "object" ? adapter : {};
  return {
    debug: typeof source.debug === "function" ? source.debug : fallback.debug,
    info: typeof source.info === "function" ? source.info : fallback.info,
    warn: typeof source.warn === "function" ? source.warn : fallback.warn,
    error: typeof source.error === "function" ? source.error : fallback.error,
    setLevel: typeof source.setLevel === "function" ? source.setLevel : fallback.setLevel,
    raw: source.raw ?? fallback.raw,
  };
}

export function createLoggerAdapterStore(defaultAdapter = {}) {
  let activeAdapter = normalizeLoggerAdapter(defaultAdapter, defaultAdapter);
  return {
    get() {
      return activeAdapter;
    },
    set(adapter = null) {
      if (!adapter) {
        activeAdapter = normalizeLoggerAdapter(defaultAdapter, defaultAdapter);
        return activeAdapter;
      }
      activeAdapter = normalizeLoggerAdapter(adapter, defaultAdapter);
      return activeAdapter;
    },
  };
}

