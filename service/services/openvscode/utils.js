/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function normalizeUserId(userId = "") { return String(userId || "").trim(); }
export function normalizeBasePath(basePath = "") {
  return String(basePath || "").trim().replace(/^\/+|\/+$/g, "");
}
export function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}
export async function readJsonFileSafe(filePath = "") {
  try {
    const parsed = JSON.parse(String(await readFile(filePath, "utf8") || "{}"));
    return isPlainObject(parsed) ? parsed : null;
  } catch { return null; }
}
