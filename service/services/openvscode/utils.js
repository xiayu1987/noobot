/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { isPlainObject, text } from "@noobot/shared/value";

export function normalizeUserId(userId = "") {
  return text(userId);
}
export function normalizeBasePath(basePath = "") {
  return text(basePath).replace(/^\/+|\/+$/g, "");
}
export function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}
export async function readJsonFileSafe(filePath = "") {
  try {
    const parsed = JSON.parse(String((await readFile(filePath, "utf8")) || "{}"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
