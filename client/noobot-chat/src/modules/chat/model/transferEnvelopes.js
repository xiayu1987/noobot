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
  const seen = new Set();
  const out = [];
  const append = (value) => {
    for (const envelope of normalizeTransferEnvelopes(value)) {
      const key = JSON.stringify(envelope);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(envelope);
    }
  };
  append(messageItem?.transferEnvelopes);
  append(messageItem?.payload?.transferEnvelopes);
  append(messageItem?.pluginMeta?.payload?.transferEnvelopes);
  append(messageItem?.pluginMeta?.payload?.nodeResultTransferEnvelopes);
  const nodeRuns = Array.isArray(messageItem?.pluginMeta?.payload?.execution?.nodeAgentRuns)
    ? messageItem.pluginMeta.payload.execution.nodeAgentRuns
    : [];
  for (const runItem of nodeRuns) {
    append(runItem?.transferEnvelopes);
    append(runItem?.nodeResultTransferEnvelopes);
  }
  const nodeSessions = Array.isArray(messageItem?.pluginMeta?.payload?.nodeSessions)
    ? messageItem.pluginMeta.payload.nodeSessions
    : [];
  for (const sessionItem of nodeSessions) {
    append(sessionItem?.transferEnvelopes);
    append(sessionItem?.nodeResultTransferEnvelopes);
  }
  return out;
}

function getTransferFilesFromEnvelope(envelope = null) {
  if (!isTransferEnvelope(envelope)) return [];
  if (Array.isArray(envelope.files) && envelope.files.length) {
    return envelope.files.filter(isPlainObject);
  }
  return [];
}

function getTransferFiles(value = null) {
  if (Array.isArray(value)) return value.flatMap((item) => getTransferFiles(item));
  if (isTransferEnvelope(value)) return getTransferFilesFromEnvelope(value);
  if (isPlainObject(value)) {
    if (Array.isArray(value.files)) return value.files.filter(isPlainObject);
    if (Array.isArray(value.transferEnvelopes)) return getTransferFiles(value.transferEnvelopes);
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
    file?.sandboxPath,
    file?.relativePath,
    file?.path,
    getAttachmentMetaDisplayPath(file?.attachmentMeta),
  );
}

function transferFileToAttachmentMeta(file = {}) {
  const attachmentMeta = isPlainObject(file?.attachmentMeta) ? file.attachmentMeta : {};
  const parsedResult = isPlainObject(file?.parsedResult)
    ? file.parsedResult
    : isPlainObject(attachmentMeta?.parsedResult)
      ? attachmentMeta.parsedResult
      : null;
  const pathView = isPlainObject(file?.pathView) ? file.pathView : {};
  const filePath = getTransferDisplayPath(file);
  const name = normalizeString(file?.name || attachmentMeta?.name || filePath.split("/").pop());
  const owner = isPlainObject(file?.owner)
    ? file.owner
    : isPlainObject(attachmentMeta?.owner)
      ? attachmentMeta.owner
      : null;
  return {
    ...attachmentMeta,
    ...(file?.attachmentId || file?.id ? { attachmentId: normalizeString(file?.attachmentId || file?.id) } : {}),
    name,
    mimeType: normalizeString(file?.mimeType || file?.type || attachmentMeta?.mimeType || "application/octet-stream"),
    size: Number(file?.size || attachmentMeta?.size || 0),
    path: normalizeString(attachmentMeta?.path || file?.path || pathView.hostPath || filePath),
    relativePath: normalizeString(attachmentMeta?.relativePath || file?.relativePath || pathView.relativePath),
    sandboxPath: normalizeString(attachmentMeta?.sandboxPath || file?.sandboxPath || pathView.sandboxPath),
    ...(file?.attachmentSource || file?.source ? { attachmentSource: normalizeString(file?.attachmentSource || file?.source) } : {}),
    ...(file?.sessionId ? { sessionId: normalizeString(file.sessionId) } : {}),
    ...(parsedResult ? { parsedResult } : {}),
    ...(file?.parsedResultAttachmentId || attachmentMeta?.parsedResultAttachmentId
      ? { parsedResultAttachmentId: normalizeString(file?.parsedResultAttachmentId || attachmentMeta?.parsedResultAttachmentId) }
      : {}),
    ...(file?.parsedResultUrl || attachmentMeta?.parsedResultUrl
      ? { parsedResultUrl: normalizeString(file?.parsedResultUrl || attachmentMeta?.parsedResultUrl) }
      : {}),
    ...(file?.parsedResultName || attachmentMeta?.parsedResultName
      ? { parsedResultName: normalizeString(file?.parsedResultName || attachmentMeta?.parsedResultName) }
      : {}),
    ...(file?.parsedResultPath || attachmentMeta?.parsedResultPath
      ? { parsedResultPath: normalizeString(file?.parsedResultPath || attachmentMeta?.parsedResultPath) }
      : {}),
    ...(file?.parsedResultRelativePath || attachmentMeta?.parsedResultRelativePath
      ? { parsedResultRelativePath: normalizeString(file?.parsedResultRelativePath || attachmentMeta?.parsedResultRelativePath) }
      : {}),
    ...(owner ? { owner } : {}),
    transferFilePath: filePath,
    transferPathView: pathView,
    transferRole: normalizeString(file?.role || ""),
  };
}

function getTransferAttachments(value = null) {
  return getTransferFiles(value)
    .map((file) => transferFileToAttachmentMeta(file))
    .filter((item) => item.name || item.path || item.relativePath || item.attachmentId || item.transferFilePath);
}

function getMessageTransferAttachments(messageItem = {}) {
  return getTransferAttachments(getMessageTransferEnvelopes(messageItem));
}

export {
  getMessageTransferAttachments,
  getMessageTransferEnvelopes,
  getTransferAttachments,
  getTransferDisplayPath,
  getTransferFiles,
  isTransferEnvelope,
  normalizeTransferEnvelope,
  normalizeTransferEnvelopes,
  transferFileToAttachmentMeta,
};
