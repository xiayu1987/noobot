/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function requireCapabilities(required = [], available = {}) {
  for (const key of required)
    if (available[key] !== true) throw new TypeError(`model capability not available: ${key}`);
  return available;
}
