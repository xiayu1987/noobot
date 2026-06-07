/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTransferEnvelope } from "./envelope.js";
import { getTransferAttachmentMetas } from "./consumer.js";

function normalizeString(value = "") {
  return String(value || "").trim();
}

function asEnvelopeList(value = null) {
  if (!value) return [];
  if (isTransferEnvelope(value)) return [value];
  if (Array.isArray(value)) return value.filter(isTransferEnvelope);
  return [];
}

function extractFileEntries(envelope = null) {
  if (!isTransferEnvelope(envelope)) return [];
  if (Array.isArray(envelope.files) && envelope.files.length) {
    return envelope.files.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  }
  if (envelope.filePath || envelope.attachmentMeta) {
    return [
      {
        filePath: normalizeString(envelope.filePath),
        attachmentMeta:
          envelope.attachmentMeta && typeof envelope.attachmentMeta === "object" && !Array.isArray(envelope.attachmentMeta)
            ? envelope.attachmentMeta
            : null,
        pathView:
          envelope.pathView && typeof envelope.pathView === "object" && !Array.isArray(envelope.pathView)
            ? envelope.pathView
            : null,
      },
    ];
  }
  return [];
}

export function buildLegacyTransferCompat({ envelope = null, envelopes = [] } = {}) {
  const normalizedEnvelopes = [
    ...asEnvelopeList(envelope),
    ...asEnvelopeList(envelopes),
  ];
  if (!normalizedEnvelopes.length) {
    return {
      attachmentMeta: null,
      attachmentMetas: [],
      filePath: "",
      filePaths: [],
      files: [],
    };
  }

  const files = normalizedEnvelopes.flatMap((item) => extractFileEntries(item));
  const filePaths = files
    .map((item = {}) =>
      normalizeString(
        item?.filePath ||
          item?.pathView?.displayPath ||
          item?.pathView?.sandboxPath ||
          item?.pathView?.relativePath ||
          item?.pathView?.hostPath,
      ),
    )
    .filter(Boolean);
  const attachmentMetas = normalizedEnvelopes.flatMap((item) => getTransferAttachmentMetas(item));
  return {
    attachmentMeta: attachmentMetas[0] || null,
    attachmentMetas,
    filePath: filePaths[0] || "",
    filePaths,
    files,
  };
}

export function buildLegacyOverflowFields({ envelope = null, hostPath = "" } = {}) {
  const normalizedHostPath = normalizeString(
    hostPath ||
      envelope?.pathView?.hostPath ||
      envelope?.attachmentMeta?.path ||
      envelope?.filePath,
  );
  const normalizedSandboxPath = normalizeString(
    envelope?.pathView?.sandboxPath ||
      envelope?.attachmentMeta?.sandboxPath ||
      envelope?.attachmentMeta?.sandboxViewPath,
  );
  return {
    ...(normalizedHostPath ? { overflow_file_path: normalizedHostPath } : {}),
    ...(normalizedSandboxPath ? { overflow_file_sandbox_path: normalizedSandboxPath } : {}),
  };
}
