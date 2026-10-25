/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "@noobot/shared/value";

export const TRANSFER_ENVELOPE_FIELD = Object.freeze({
  TRANSFER: "transferEnvelopes",
  NODE_RESULT: "nodeResultTransferEnvelopes",
});

export const TRANSFER_ENVELOPE_FIELDS = Object.freeze(Object.values(TRANSFER_ENVELOPE_FIELD));

export function isTransferEnvelopeField(key) {
  return TRANSFER_ENVELOPE_FIELDS.includes(key);
}

export function readTransferEnvelopeList(carrier, field) {
  if (!isTransferEnvelopeField(field)) {
    throw new Error(`transfer_envelope_field_invalid:${String(field)}`);
  }
  if (!isPlainObject(carrier)) {
    throw new Error(`transfer_envelope_carrier_invalid:${field}`);
  }
  const value = carrier[field];
  if (!Array.isArray(value)) {
    throw new Error(`transfer_envelope_list_invalid:${field}`);
  }
  return value;
}

export function collectAllTransferEnvelopeLists(sources = [], fields = TRANSFER_ENVELOPE_FIELDS) {
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return (Array.isArray(sources) ? sources : [sources]).flatMap((source) => {
    if (!isPlainObject(source)) return [];
    return fieldList.flatMap((field) => (Array.isArray(source[field]) ? source[field] : []));
  });
}
