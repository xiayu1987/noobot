/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TRANSFER_ENVELOPE_FIELD = Object.freeze({
  TRANSFER: "transferEnvelopes",
  NODE_RESULT: "nodeResultTransferEnvelopes",
});

export const TRANSFER_ENVELOPE_FIELDS = Object.freeze([
  TRANSFER_ENVELOPE_FIELD.TRANSFER,
  TRANSFER_ENVELOPE_FIELD.NODE_RESULT,
]);

export const NODE_RESULT_FIRST_FIELDS = Object.freeze([
  TRANSFER_ENVELOPE_FIELD.NODE_RESULT,
  TRANSFER_ENVELOPE_FIELD.TRANSFER,
]);

export const TRANSFER_FIRST_FIELDS = Object.freeze([
  TRANSFER_ENVELOPE_FIELD.TRANSFER,
  TRANSFER_ENVELOPE_FIELD.NODE_RESULT,
]);

export function isTransferEnvelopeField(key = "") {
  return TRANSFER_ENVELOPE_FIELDS.includes(String(key));
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function pickTransferEnvelopeList(
  source = null,
  fields = NODE_RESULT_FIRST_FIELDS,
  { skipEmpty = true } = {},
) {
  if (!isRecord(source)) return [];
  for (const field of Array.isArray(fields) ? fields : [fields]) {
    const value = source[field];
    if (!Array.isArray(value)) continue;
    if (skipEmpty && !value.length) continue;
    return value;
  }
  return [];
}

export function collectTransferEnvelopeLists(
  sources = [],
  fields = NODE_RESULT_FIRST_FIELDS,
  options = undefined,
) {
  return (Array.isArray(sources) ? sources : [sources]).flatMap((source) =>
    pickTransferEnvelopeList(source, fields, options),
  );
}

export function collectAllTransferEnvelopeLists(sources = [], fields = TRANSFER_ENVELOPE_FIELDS) {
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return (Array.isArray(sources) ? sources : [sources]).flatMap((source) => {
    if (!isRecord(source)) return [];
    return fieldList.flatMap((field) => (Array.isArray(source[field]) ? source[field] : []));
  });
}
