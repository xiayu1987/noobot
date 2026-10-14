/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { trim } from "./normalize.js";

export function resolveEventScope(value = {}) {
  return trim(value.turnScopeId);
}

export function resolveRunTurnScopeId(value = {}) {
  return trim(value.turnScopeId);
}
