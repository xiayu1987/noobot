/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync } from "node:fs";

export function readJsonFile(filePath, fallback = {}) {
  if (!existsSync(filePath)) return fallback;
  const raw = readFileSync(filePath, "utf8");
  if (!raw || !raw.trim()) return fallback;
  return JSON.parse(raw);
}
