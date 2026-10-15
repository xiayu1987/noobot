/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function isChildRunEventData(eventData = {}, { rootSessionId = "" } = {}) {
  return text(eventData?.sessionId) !== text(rootSessionId);
}
