/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConfigDocumentText } from "@noobot/agent-config-protocol";

export function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

export function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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

export async function readConfigDocument(filePath, { allowMissing = false } = {}) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return {};
    throw error;
  }
  return parseConfigDocumentText(source);
}

export async function writeJson(filePath = "", payload = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
