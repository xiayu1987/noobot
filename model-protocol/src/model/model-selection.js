/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createModelSelection({ alias = "", name = "", profile = "" } = {}) {
  if (!String(alias || name).trim()) throw new TypeError("model selection requires alias or name");
  return Object.freeze({
    alias: String(alias).trim(),
    name: String(name).trim(),
    profile: String(profile).trim(),
  });
}
