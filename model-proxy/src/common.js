/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import { text, isObjectLike } from "@noobot/shared/value";

function pad(numberValue, lengthValue = 2) {
  return String(numberValue).padStart(lengthValue, "0");
}

function sha256Text(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function tryParseJson(inputText = "") {
  try {
    return JSON.parse(String(inputText || ""));
  } catch {
    return null;
  }
}

function getHeaderValue(headers = {}, candidateKeys = []) {
  if (!isObjectLike(headers)) return "";
  const keys = Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys];
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [text(key).toLowerCase(), value])
      .filter(([key]) => Boolean(key)),
  );
  for (const key of keys) {
    const normalizedKey = text(key).toLowerCase();
    if (!normalizedKey) continue;
    const rawHeaderValue = normalizedHeaders[normalizedKey];
    if (Array.isArray(rawHeaderValue)) {
      const value = text(rawHeaderValue[0]);
      if (value) return value;
      continue;
    }
    const value = text(rawHeaderValue);
    if (value) return value;
  }
  return "";
}

export { getHeaderValue, pad, sha256Text, tryParseJson };
