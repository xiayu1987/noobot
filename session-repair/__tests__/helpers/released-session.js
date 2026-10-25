/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";

export function releasedSession(fields) {
  return {
    messages: [],
    turnTimings: [],
    ...fields,
    turnLifecycle: { ...createEmptyTurnLifecycle(), ...fields.turnLifecycle },
  };
}
