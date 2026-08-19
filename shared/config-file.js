/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const CONFIG_FILE_ERROR_CODE = Object.freeze({
  CORRUPTED: "CONFIG_FILE_CORRUPTED",
  READ_FAILED: "CONFIG_FILE_READ_FAILED",
});

function configFileError(code, filePath, cause) {
  const error = new Error(`${code}:${path.resolve(filePath)}`, { cause });
  error.name = "ConfigFileError";
  error.code = code;
  error.filePath = path.resolve(filePath);
  return error;
}

export function readOptionalJsonObjectConfigSync({ filePath, defaultValue = {} } = {}) {
  const normalizedPath = path.resolve(String(filePath || "").trim());
  let raw;
  try {
    raw = readFileSync(normalizedPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(defaultValue);
    throw configFileError(CONFIG_FILE_ERROR_CODE.READ_FAILED, normalizedPath, error);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw configFileError(CONFIG_FILE_ERROR_CODE.CORRUPTED, normalizedPath, error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configFileError(
      CONFIG_FILE_ERROR_CODE.CORRUPTED,
      normalizedPath,
      new TypeError("configuration root must be an object"),
    );
  }
  return parsed;
}
