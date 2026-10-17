/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { isPlainObject } from "@noobot/shared/value";

export const BUILTIN_ATTACHMENT_POLICY = Object.freeze({
  maxFileCount: QUANTITY_THRESHOLDS.attachments.maxFileCount,
  maxFileSizeBytes: LENGTH_THRESHOLDS.attachments.maxFileSizeBytes,
  maxTotalSizeBytes: LENGTH_THRESHOLDS.attachments.maxTotalSizeBytes,
  allowedMimeTypes: Object.freeze([]),
  allowedExtensions: Object.freeze([]),
});

const LIMIT_KEYS = Object.freeze(["maxFileCount", "maxFileSizeBytes", "maxTotalSizeBytes"]);

function resolveLimit(attachments, key) {
  if (!Object.hasOwn(attachments, key)) return BUILTIN_ATTACHMENT_POLICY[key];
  const value = attachments[key];
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`attachments.${key} must be a positive integer`);
  }
  return value;
}

function normalizeExtension(item) {
  if (typeof item !== "string" || !item.trim()) {
    throw new TypeError("attachments.allowedExtensions items must be non-empty strings");
  }
  const lowered = item.trim().toLowerCase();
  return lowered.startsWith(".") ? lowered : `.${lowered}`;
}

function resolveAllowedExtensions(attachments) {
  if (!Object.hasOwn(attachments, "allowedExtensions")) {
    return BUILTIN_ATTACHMENT_POLICY.allowedExtensions;
  }
  const value = attachments.allowedExtensions;
  if (!Array.isArray(value)) throw new TypeError("attachments.allowedExtensions must be an array");
  return Object.freeze([...new Set(value.map(normalizeExtension))]);
}

export function resolveAttachmentPolicy(globalConfig) {
  if (!isPlainObject(globalConfig)) throw new TypeError("globalConfig must be a plain object");
  if (!Object.hasOwn(globalConfig, "attachments")) return BUILTIN_ATTACHMENT_POLICY;
  const { attachments } = globalConfig;
  if (!isPlainObject(attachments)) throw new TypeError("attachments must be a plain object");
  return Object.freeze({
    ...Object.fromEntries(LIMIT_KEYS.map((key) => [key, resolveLimit(attachments, key)])),
    allowedMimeTypes: BUILTIN_ATTACHMENT_POLICY.allowedMimeTypes,
    allowedExtensions: resolveAllowedExtensions(attachments),
  });
}
