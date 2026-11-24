/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RETIRED_SESSION_PROJECTION_FIELDS } from "@noobot/session-protocol";

export function removeRetiredSessionProjections(session) {
  let changed = false;
  for (const field of RETIRED_SESSION_PROJECTION_FIELDS) {
    if (!Object.hasOwn(session, field)) continue;
    delete session[field];
    changed = true;
  }
  return changed;
}
