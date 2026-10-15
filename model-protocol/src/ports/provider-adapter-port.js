/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export function requireProviderAdapter(adapter) {
  if (!text(adapter?.id)) throw new TypeError("provider adapter.id is required");
  for (const key of ["createClient", "classifyError", "bindTools", "prepareMessages"])
    if (typeof adapter?.[key] !== "function")
      throw new TypeError(`provider adapter.${key} is required`);
  if (adapter.executeOperation !== undefined && typeof adapter.executeOperation !== "function") {
    throw new TypeError("provider adapter.executeOperation must be a function");
  }
  return adapter;
}
