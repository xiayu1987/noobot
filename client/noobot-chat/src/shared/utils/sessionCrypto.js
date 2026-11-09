/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

function textToBytes(inputText = "") {
  return new TextEncoder().encode(String(inputText || ""));
}

function xorBytes(data = new Uint8Array(), key = new Uint8Array()) {
  if (!data?.length || !key?.length) return new Uint8Array();
  const out = new Uint8Array(data.length);
  for (let byteIndex = 0; byteIndex < data.length; byteIndex += 1) {
    out[byteIndex] = data[byteIndex] ^ key[byteIndex % key.length];
  }
  return out;
}

function bytesToBase64(bytes = new Uint8Array()) {
  let binary = "";
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1)
    binary += String.fromCharCode(bytes[byteIndex]);
  return btoa(binary);
}

export function encryptPayloadBySessionId(payload = {}, sessionId = "") {
  const sid = text(sessionId);
  if (!sid) throw new Error("sessionId required for encryption");
  const plainText = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const source = textToBytes(plainText);
  const key = textToBytes(sid);
  return bytesToBase64(xorBytes(source, key));
}
