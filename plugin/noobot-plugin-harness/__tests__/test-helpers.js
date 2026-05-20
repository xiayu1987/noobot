/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function waitForFile(file, retries = 200, delayMs = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await exists(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

export async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return String(text || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
