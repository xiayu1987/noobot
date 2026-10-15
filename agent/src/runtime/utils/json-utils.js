/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

export function parseJsonObjectSafely(input = "") {
  const normalizedText = text(input);
  if (!normalizedText) return null;
  try {
    const parsed = JSON.parse(normalizedText);
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return null;
}
