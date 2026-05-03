/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../i18n/system-text.js";

function toUtf8Bytes(input = "") {
  return Buffer.from(String(input || ""), "utf8");
}

function xorBytes(data = Buffer.alloc(0), key = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(data) || !Buffer.isBuffer(key) || key.length === 0) {
    return Buffer.alloc(0);
  }
  const out = Buffer.allocUnsafe(data.length);
  for (let byteIndex = 0; byteIndex < data.length; byteIndex += 1) {
    out[byteIndex] = data[byteIndex] ^ key[byteIndex % key.length];
  }
  return out;
}

function normalizeSessionId(sessionId = "") {
  const normalized = String(sessionId || "").trim();
  if (!normalized) throw new Error(tSystem("common.sessionIdRequiredForCrypto"));
  return normalized;
}

export function encryptTextBySessionId(text = "", sessionId = "") {
  const sid = normalizeSessionId(sessionId);
  const source = toUtf8Bytes(String(text || ""));
  const key = toUtf8Bytes(sid);
  return xorBytes(source, key).toString("base64");
}

export function decryptTextBySessionId(cipherText = "", sessionId = "") {
  const sid = normalizeSessionId(sessionId);
  const source = Buffer.from(String(cipherText || ""), "base64");
  const key = toUtf8Bytes(sid);
  return xorBytes(source, key).toString("utf8");
}

export function encryptPayloadBySessionId(payload = {}, sessionId = "") {
  const plainText =
    typeof payload === "string" ? payload : JSON.stringify(payload || {});
  return encryptTextBySessionId(plainText, sessionId);
}

export function decryptPayloadBySessionId(cipherText = "", sessionId = "") {
  const text = decryptTextBySessionId(cipherText, sessionId);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
