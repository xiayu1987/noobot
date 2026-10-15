/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function resolveControlToolOutcome(toolCallResults = [], toolName = "") {
  const expectedName = text(toolName);
  const attempts = (Array.isArray(toolCallResults) ? toolCallResults : []).filter(
    (result) => text(result?.call?.name) === expectedName,
  );
  return Object.freeze({
    attempted: attempts.length > 0,
    accepted: attempts.some((result) => result?.success === true),
  });
}
