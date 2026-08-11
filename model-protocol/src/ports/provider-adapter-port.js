/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireProviderAdapter(adapter) {
  if (!String(adapter?.id || "").trim()) throw new TypeError("provider adapter.id is required");
  if (!Array.isArray(adapter?.formats) || adapter.formats.length < 1) {
    throw new TypeError("provider adapter.formats is required");
  }
  for (const key of ["createClient", "classifyError"])
    if (typeof adapter?.[key] !== "function") throw new TypeError(`provider adapter.${key} is required`);
  if (adapter.executeOperation !== undefined && typeof adapter.executeOperation !== "function") {
    throw new TypeError("provider adapter.executeOperation must be a function");
  }
  return adapter;
}
