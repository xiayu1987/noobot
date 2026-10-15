/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function nullishText(value) {
  return text(value);
}

export function positiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
}
