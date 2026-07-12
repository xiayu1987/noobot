/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function isPlainObject(input) {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

export function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

export function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

export async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonRelaxed(filePath = "", fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function readJsonStrict(filePath = "", label = "JSON") {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} parse failed: ${filePath} (${error?.message || String(error)})`);
  }
}

export async function writeJson(filePath = "", payload = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
