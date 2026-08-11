/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createToolBinding(tools = [], options = {}) {
  if (!Array.isArray(tools)) throw new TypeError("tools must be an array");
  return Object.freeze({ tools, options: Object.freeze({ ...options }) });
}
