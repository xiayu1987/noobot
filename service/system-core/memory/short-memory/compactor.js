/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSortedShortItems } from "./reader.js";
import { assignShortItems } from "./writer.js";

export function compactShortMemory(short = {}) {
  assignShortItems(short, getSortedShortItems(short));
}

