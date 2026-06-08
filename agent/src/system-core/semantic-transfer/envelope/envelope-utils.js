/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTransferEnvelope } from "./envelope.js";
import { validateTransferEnvelope } from "./validator.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractTransferEnvelopeFromPersisted(persisted = null) {
  if (!isPlainObject(persisted)) return null;
  const candidates = [
    persisted.transferEnvelope,
    persisted.envelope,
    persisted?.result?.envelope,
    persisted?.transferResult?.envelope,
  ];
  return candidates.find((item) => isPlainObject(item)) || null;
}

export function normalizeTransferEnvelopes(value = null) {
  return normalizeTransferEnvelopesWithPolicy(value);
}

function resolveStrictEnvelopeValidation(runtime = {}, strict = null) {
  if (typeof strict === "boolean") return strict;
  const userStrict = runtime?.userConfig?.semanticTransfer?.strictEnvelopeValidation;
  if (typeof userStrict === "boolean") return userStrict;
  const globalStrict = runtime?.globalConfig?.semanticTransfer?.strictEnvelopeValidation;
  if (typeof globalStrict === "boolean") return globalStrict;
  return false;
}

export function normalizeTransferEnvelopesWithPolicy(
  value = null,
  {
    runtime = {},
    strict = null,
    enforceProtocol = false,
    withStats = false,
  } = {},
) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const strictMode = resolveStrictEnvelopeValidation(runtime, strict);
  let invalidCount = 0;
  const normalized = list.filter((item) => {
    if (!isPlainObject(item)) return false;
    const hasLegacyShape =
      (Array.isArray(item.files) && item.files.length) || Boolean(item.filePath || item.attachmentMeta || item.pathView);
    const validEnvelope = isTransferEnvelope(item) || validateTransferEnvelope(item).ok;
    if (enforceProtocol) {
      if (!validEnvelope && hasLegacyShape) invalidCount += 1;
      return validEnvelope;
    }
    return validEnvelope || hasLegacyShape;
  });
  if (strictMode && invalidCount > 0) {
    throw new Error(`invalid transfer envelopes: ${invalidCount}`);
  }
  if (!withStats) return normalized;
  return {
    envelopes: normalized,
    stats: {
      inputCount: list.filter((item) => isPlainObject(item)).length,
      outputCount: normalized.length,
      filteredCount: Math.max(0, list.filter((item) => isPlainObject(item)).length - normalized.length),
      invalidCount,
      strict: strictMode,
      enforceProtocol: enforceProtocol === true,
    },
  };
}
