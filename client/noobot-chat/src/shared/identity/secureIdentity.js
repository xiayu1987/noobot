/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function secureCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== "function") {
    throw new Error("secure Web Crypto identity source is unavailable");
  }
  return crypto;
}

export function createSecureUuid() {
  const crypto = secureCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

export function createSecureId(prefix = "id", separator = ":") {
  const normalizedPrefix = String(prefix || "").trim();
  if (!normalizedPrefix) throw new TypeError("secure identity prefix is required");
  return `${normalizedPrefix}${separator}${createSecureUuid()}`;
}
