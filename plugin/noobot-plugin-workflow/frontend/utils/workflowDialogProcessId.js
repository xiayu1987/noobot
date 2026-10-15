/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function resolveWorkflowDialogProcessId(item = {}) {
  return text(item?.dialogProcessId);
}

export function collectWorkflowDialogProcessIds(...items) {
  return items
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      return [item?.dialogProcessId];
    })
    .map((value) => text(value))
    .filter(Boolean);
}
