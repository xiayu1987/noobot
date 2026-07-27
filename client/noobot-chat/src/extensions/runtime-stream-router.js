/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { provideExtensionValues } from "./extension-registry.js";
import { EXTENSION_POINTS } from "./extension-point-ids.js";

export function routeRuntimeStreamEvent(event = "", data = {}, context = {}) {
  const routes = provideExtensionValues(EXTENSION_POINTS.RUNTIME_STREAM_ROUTE, {
    event,
    data,
    context,
  });
  for (const route of routes) {
    if (typeof route !== "function") continue;
    try {
      if (route({ event, data, context }) === true) return true;
    } catch (error) {
      console.warn(`[runtime-stream-router] route failed: ${error?.message || error}`);
    }
  }
  return false;
}
