/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const TRANSFER_PROTOCOL = "noobot.semantic-transfer";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function isTransferEnvelope(value = null) {
  return isPlainObject(value) && value.protocol === TRANSFER_PROTOCOL;
}

function normalizeTransferEnvelope(value = null) {
  return isTransferEnvelope(value) ? value : null;
}

function normalizeTransferEnvelopes(value = null) {
  if (Array.isArray(value)) return value.map(normalizeTransferEnvelope).filter(Boolean);
  const one = normalizeTransferEnvelope(value);
  return one ? [one] : [];
}

function getMessageTransferEnvelopes(messageItem = {}) {
  return [
    ...normalizeTransferEnvelopes(messageItem?.transferEnvelopes),
    ...normalizeTransferEnvelopes(messageItem?.transferResult?.envelope),
  ];
}

function getTransferFilesFromEnvelope(envelope = null) {
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

function getTransferFiles(value = null) {
  if (Array.isArray(value)) return value.flatMap((item) => getTransferFiles(item));
  if (isTransferEnvelope(value)) return getTransferFilesFromEnvelope(value);
  if (isPlainObject(value)) {
    if (Array.isArray(value.files)) return value.files.filter(isPlainObject);
    if (Array.isArray(value.transferEnvelopes)) return getTransferFiles(value.transferEnvelopes);
    if (isTransferEnvelope(value.transferResult?.envelope)) return getTransferFiles(value.transferResult.envelope);
  }
  return [];
}

function firstNormalizedString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return "";
}

function getPathViewDisplayPath(pathView = {}) {
  if (!isPlainObject(pathView)) return "";
  return firstNormalizedString(pathView.displayPath, pathView.sandboxPath, pathView.relativePath, pathView.hostPath);
}

function getAttachmentMetaDisplayPath(attachmentMeta = {}) {
  if (!isPlainObject(attachmentMeta)) return "";
  return firstNormalizedString(
    attachmentMeta.sandboxPath,
    attachmentMeta.sandboxViewPath,
    attachmentMeta.relativePath,
    attachmentMeta.path,
    attachmentMeta.name,
  );
}

function getTransferDisplayPath(file = {}) {
  return firstNormalizedString(
    getPathViewDisplayPath(file?.pathView),
    file?.filePath,
    getAttachmentMetaDisplayPath(file?.attachmentMeta),
  );
}

function transferFileToAttachmentMeta(file = {}) {
  const attachmentMeta = isPlainObject(file?.attachmentMeta) ? file.attachmentMeta : {};
  const pathView = isPlainObject(file?.pathView) ? file.pathView : {};
  const filePath = getTransferDisplayPath(file);
  const name = normalizeString(file?.name || attachmentMeta?.name || filePath.split("/").pop());
  return {
    ...attachmentMeta,
    name,
    mimeType: normalizeString(file?.mimeType || attachmentMeta?.mimeType || "application/octet-stream"),
    size: Number(file?.size || attachmentMeta?.size || 0),
    path: normalizeString(attachmentMeta?.path || pathView.hostPath || filePath),
    relativePath: normalizeString(attachmentMeta?.relativePath || pathView.relativePath),
    sandboxPath: normalizeString(attachmentMeta?.sandboxPath || pathView.sandboxPath),
    transferFilePath: filePath,
    transferPathView: pathView,
    transferRole: normalizeString(file?.role || ""),
  };
}

function getTransferAttachmentMetas(value = null) {
  return getTransferFiles(value)
    .map((file) => transferFileToAttachmentMeta(file))
    .filter((item) => item.name || item.path || item.relativePath || item.attachmentId || item.transferFilePath);
}

function getMessageTransferAttachmentMetas(messageItem = {}) {
  return getTransferAttachmentMetas(getMessageTransferEnvelopes(messageItem));
}

export {
  getMessageTransferAttachmentMetas,
  getMessageTransferEnvelopes,
  getTransferAttachmentMetas,
  getTransferDisplayPath,
  getTransferFiles,
  isTransferEnvelope,
  normalizeTransferEnvelope,
  normalizeTransferEnvelopes,
  transferFileToAttachmentMeta,
};
