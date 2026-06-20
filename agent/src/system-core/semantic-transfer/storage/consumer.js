/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTransferEnvelope } from "../envelope/envelope.js";
import { normalizeTransferEnvelopes } from "../envelope/envelope-utils.js";
import { emitEvent } from "../../event/index.js";
import { resolveTransferFilePath } from "./path-resolver.js";
import { firstNormalizedString } from "../core/compact.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isLegacyTransferLikeInput(value = null) {
  if (!value) return false;
  if (isTransferEnvelope(value)) return false;
  if (Array.isArray(value)) {
    const list = value.filter(isPlainObject);
    if (!list.length) return false;
    return list.some((item = {}) => !isTransferEnvelope(item));
  }
  if (!isPlainObject(value)) return false;
  if (isTransferEnvelope(value)) return false;
  const legacyKeys = ["attachmentMetas", "attachmentMeta", "filePath", "path", "relativePath"];
  return legacyKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function emitLegacyInputWarning({
  runtime = {},
  api = "",
  value = null,
} = {}) {
  if (!isLegacyTransferLikeInput(value)) return;
  const source = isPlainObject(value)
    ? value
    : Array.isArray(value) && isPlainObject(value[0])
      ? value[0]
      : {};
  const legacyKeys = ["attachmentMetas", "attachmentMeta", "filePath", "path", "relativePath"].filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key),
  );
  emitEvent(runtime?.eventListener || null, "semantic_transfer_legacy_input_warning", {
    api: normalizeString(api) || "unknown",
    legacyKeys,
    message: "legacy semantic-transfer input is no longer supported; please provide transfer envelope(s)",
  });
}

function envelopeToFiles(envelope = null) {
  if (!isTransferEnvelope(envelope)) return [];
  if (Array.isArray(envelope.files) && envelope.files.length) {
    return envelope.files.filter(isPlainObject);
  }
  if (envelope.filePath || envelope.attachmentMeta) {
    return [
      {
        filePath: normalizeString(envelope.filePath),
        ...(isPlainObject(envelope.attachmentMeta) ? { attachmentMeta: envelope.attachmentMeta } : {}),
        ...(isPlainObject(envelope.pathView) ? { pathView: envelope.pathView } : {}),
        role: "primary",
      },
    ];
  }
  return [];
}

function collectTransferEnvelopes(value = null) {
  const dedupe = (envelopes = []) => {
    const seen = new Set();
    const out = [];
    for (const envelope of normalizeTransferEnvelopes(envelopes)) {
      const key =
        normalizeString(
          envelope?.files?.[0]?.attachmentMeta?.attachmentId ||
            envelope?.attachmentMeta?.attachmentId ||
            envelope?.files?.[0]?.filePath ||
            envelope?.filePath,
        ) || JSON.stringify(envelope);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(envelope);
    }
    return out;
  };
  if (!value) return [];
  if (isTransferEnvelope(value)) return dedupe([value]);
  if (Array.isArray(value)) return dedupe(value);
  if (!isPlainObject(value)) return [];
  return dedupe([
    // @deprecated compat: accept legacy singular `transferEnvelope` as an input alias only.
    value.transferEnvelope,
    value?.transferResult?.envelope,
    ...(Array.isArray(value.transferEnvelopes) ? value.transferEnvelopes : []),
    value,
  ]);
}

export function getTransferFiles(value = null, { runtime = {}, agentContext = null } = {}) {
  void agentContext;
  emitLegacyInputWarning({ runtime, api: "getTransferFiles", value });
  const envelopes = collectTransferEnvelopes(value);
  const fromEnvelopes = envelopes.flatMap((envelope) => envelopeToFiles(envelope));
  return fromEnvelopes;
}

export function getPrimaryTransferFile(value = null, options = {}) {
  return getTransferFiles(value, options)[0] || null;
}

export function getTransferDisplayPath(value = null, options = {}) {
  const file = getPrimaryTransferFile(value, options);
  if (!file) return "";
  const attachmentMeta = isPlainObject(file?.attachmentMeta) ? file.attachmentMeta : {};
  const pathView = isPlainObject(file?.pathView) ? file.pathView : {};
  return firstNormalizedString(
    pathView?.displayPath,
    file?.filePath,
    resolveTransferFilePath({
      attachmentMeta,
      path: pathView?.hostPath || "",
      hostPath: pathView?.hostPath || "",
      relativePath: pathView?.relativePath || "",
      runtime: options?.runtime || {},
      agentContext: options?.agentContext || null,
      purpose: "semantic_transfer_display_path",
    }),
  );
}

export function getTransferAttachmentMetas(value = null, { runtime = {} } = {}) {
  emitLegacyInputWarning({ runtime, api: "getTransferAttachmentMetas", value });
  const envelopes = collectTransferEnvelopes(value);
  const fromEnvelopes = envelopes.flatMap((envelope = {}) => {
    const fromFiles = Array.isArray(envelope.files)
      ? envelope.files.map((item = {}) => item?.attachmentMeta).filter(isPlainObject)
      : [];
    if (fromFiles.length) return fromFiles;
    return isPlainObject(envelope.attachmentMeta) ? [envelope.attachmentMeta] : [];
  });
  return fromEnvelopes;
}
