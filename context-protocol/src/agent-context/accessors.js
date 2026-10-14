/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveAgentContextIdentity } from "./identity.js";

export function getAgentContextIdentity(context = {}) {
  return resolveAgentContextIdentity(context);
}
