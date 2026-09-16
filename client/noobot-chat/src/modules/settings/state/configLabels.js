/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const CONFIG_FIELD_LABEL_NAMESPACE = "configFields";
const CONFIG_FIELD_DESCRIPTION_NAMESPACE = "configFieldDescriptions";

function translateOrEmpty(translate, messageKey) {
  const text = translate(messageKey);
  return text === messageKey ? "" : text;
}

export function resolveConfigFieldLabel(translate, key) {
  const rawKey = String(key ?? "");
  if (!rawKey) return "";
  if (rawKey.trim() !== "" && !Number.isNaN(Number(rawKey))) return `#${Number(rawKey) + 1}`;
  const messageKey = `${CONFIG_FIELD_LABEL_NAMESPACE}.${rawKey}`;
  const text = translate(messageKey);
  return text === messageKey ? rawKey : text;
}

export function resolveConfigNodeHint(translate, key) {
  const rawKey = String(key ?? "");
  if (!rawKey) return "";
  const label = resolveConfigFieldLabel(translate, rawKey);
  return label === rawKey ? "" : rawKey;
}

export function resolveConfigPathLabels(translate, trail = []) {
  return trail.map((navNode) => resolveConfigFieldLabel(translate, navNode.key));
}

export function resolveConfigFieldDescription(translate, key) {
  const rawKey = String(key ?? "");
  if (!rawKey) return "";
  return translateOrEmpty(translate, `${CONFIG_FIELD_DESCRIPTION_NAMESPACE}.${rawKey}`);
}

export function resolveConfigConstraintText(node) {
  if (!node) return "";
  const min = typeof node.minimum === "number" ? node.minimum : null;
  const max = typeof node.maximum === "number" ? node.maximum : null;
  if (min !== null && max !== null) return `${min} ~ ${max}`;
  if (min !== null) return `≥ ${min}`;
  if (max !== null) return `≤ ${max}`;
  return "";
}

