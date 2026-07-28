/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile } from "node:fs/promises";

export async function readJsonFile(filePath, fallback = {}) {
  try {
    await access(filePath);
  } catch {
    return fallback;
  }
  const raw = await readFile(filePath, "utf8");
  if (!raw || !raw.trim()) return fallback;
  return JSON.parse(raw);
}
