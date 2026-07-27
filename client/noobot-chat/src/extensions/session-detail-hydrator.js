/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { provideExtensionValues } from "./extension-registry.js";
import { EXTENSION_POINTS } from "./extension-point-ids.js";

export function hydrateSessionDetailExtensions(payload = {}, context = {}) {
  const hydrators = provideExtensionValues(EXTENSION_POINTS.SESSION_DETAIL_HYDRATOR, {
    payload,
    context,
  });
  return hydrators.reduce((count, hydrate) => {
    if (typeof hydrate !== "function") return count;
    try {
      return count + Number(hydrate(payload, context) || 0);
    } catch (error) {
      console.warn(`[session-detail-hydrator] contribution failed: ${error?.message || error}`);
      return count;
    }
  }, 0);
}
