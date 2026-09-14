/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { isPlainObject } from "../../shared/utils/shared-utils.js";

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(isPlainObject(value) ? value : {}).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0;
      if (isPlainObject(item)) return Object.keys(item).length > 0;
      return item !== undefined && item !== null && item !== "";
    }),
  );
}

export function firstNormalizedString(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export function normalizeString(value = "") {
  return String(value || "").trim();
}

export const COMPACT_TRANSFER_PAYLOAD_FIELDS = Object.freeze(["transferEnvelopes"]);
export const COMPACT_TRANSFER_FILE_FIELDS = Object.freeze([
  "identity",
  "role",
  "name",
  "mimeType",
  "size",
  "preview",
]);

function validateAndDedupeEnvelopes(value) {
  const source = isPlainObject(value) && Array.isArray(value.transferEnvelopes)
    ? value.transferEnvelopes
    : value;
  return normalizeTransferEnvelopes(source);
}

export function compactTransferPayloadForModel(payload = {}) {
  const envelopes = validateAndDedupeEnvelopes(payload);
  return envelopes.length ? { transferEnvelopes: envelopes } : {};
}

export function compactToolResultPayloadForModel(payload = {}) {
  if (!isPlainObject(payload)) return payload;
  const compactPayload = { ...payload };
  delete compactPayload.compactTransferPayload;
  delete compactPayload.compactToolPayload;
  const transferPayload = compactTransferPayloadForModel(payload);
  return compactObject({ ...compactPayload, ...transferPayload });
}

export function compactToolResultTextForModel(toolResultText = "") {
  const raw = String(toolResultText || "");
  if (!raw.trim()) return raw;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? JSON.stringify(compactToolResultPayloadForModel(parsed)) : raw;
  } catch {
    return raw;
  }
}

