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

/**
 * 按给定字段优先序取出第一个可用的 envelope 列表。
 * skipEmpty=true：空数组视为缺失，继续看下一个字段。
 * skipEmpty=false：只要字段是数组就返回，等价于 `a || b` 的降级语义。
 */
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

/**
 * 不做优先序取舍：把每个来源上所有 envelope 字段的数组全部收下。
 * 适用于「多路来源汇总后再按身份去重」的场景。
 */
export function collectAllTransferEnvelopeLists(sources = [], fields = TRANSFER_ENVELOPE_FIELDS) {
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return (Array.isArray(sources) ? sources : [sources]).flatMap((source) => {
    if (!isRecord(source)) return [];
    return fieldList.flatMap((field) => (Array.isArray(source[field]) ? source[field] : []));
  });
}
