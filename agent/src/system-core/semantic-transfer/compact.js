/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactObject(value = {}) {
  const output = {};
  for (const [key, itemValue] of Object.entries(isPlainObject(value) ? value : {})) {
    if (itemValue === "" || itemValue === null || itemValue === undefined) continue;
    if (Array.isArray(itemValue) && !itemValue.length) continue;
    if (isPlainObject(itemValue) && !Object.keys(itemValue).length) continue;
    output[key] = itemValue;
  }
  return output;
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeTransferEnvelopeList(payload = {}) {
  if (!isPlainObject(payload)) return [];
  const transferResult = isPlainObject(payload?.transferResult) ? payload.transferResult : null;
  return [
    isPlainObject(payload?.transferEnvelope) ? payload.transferEnvelope : null,
    isPlainObject(transferResult?.envelope) ? transferResult.envelope : null,
    ...(Array.isArray(payload?.transferEnvelopes) ? payload.transferEnvelopes : []),
  ].filter(isPlainObject);
}

function getTransferFilesFromEnvelope(envelope = {}) {
  if (!isPlainObject(envelope)) return [];
  if (Array.isArray(envelope.files) && envelope.files.length) {
    return envelope.files.filter(isPlainObject);
  }
  return [];
}

function compactLegacyEnvelopeFileForModel(envelope = {}) {
  if (!isPlainObject(envelope)) return {};
  const pathView = isPlainObject(envelope.pathView) ? envelope.pathView : {};
  const sourceMeta = isPlainObject(envelope.attachmentMeta) ? envelope.attachmentMeta : {};
  const attachment = compactAttachmentMetaForModel(sourceMeta);
  const transferFilePath = normalizeString(
    pathView.displayPath ||
      envelope.filePath ||
      pathView.sandboxPath ||
      pathView.relativePath ||
      attachment.sandboxPath ||
      attachment.relativePath,
  );
  return compactObject({
    ...attachment,
    transferFilePath,
    role: "primary",
  });
}

export function compactAttachmentMetaForModel(meta = {}) {
  if (!isPlainObject(meta)) return {};
  return compactObject({
    attachmentId: meta.attachmentId,
    sessionId: meta.sessionId,
    attachmentSource: meta.attachmentSource,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    relativePath: meta.relativePath,
    sandboxPath: meta.sandboxPath || meta.sandboxViewPath,
    generatedByModel: meta.generatedByModel,
    generationSource: meta.generationSource,
    parsedResultAttachmentId: meta.parsedResultAttachmentId,
    parsedResultRelativePath: meta.parsedResultRelativePath,
    parsedResultTool: meta.parsedResultTool,
  });
}

function transferFileToModelFile(file = {}) {
  const attachmentMeta = compactAttachmentMetaForModel(file?.attachmentMeta || {});
  const pathView = isPlainObject(file?.pathView) ? file.pathView : {};
  const transferFilePath = normalizeString(
    pathView.displayPath ||
      file?.filePath ||
      pathView.sandboxPath ||
      pathView.relativePath ||
      attachmentMeta.sandboxPath ||
      attachmentMeta.relativePath,
  );
  return compactObject({
    ...attachmentMeta,
    transferFilePath,
    role: file?.role,
  });
}

export function compactTransferPayloadForModel(payload = {}) {
  if (!isPlainObject(payload)) return {};
  const envelopes = normalizeTransferEnvelopeList(payload);
  if (envelopes.length) {
    const seen = new Set();
    const transferFiles = envelopes
      .flatMap((envelope) => {
        const files = getTransferFilesFromEnvelope(envelope);
        if (files.length) return files.map(transferFileToModelFile);
        const legacyFile = compactLegacyEnvelopeFileForModel(envelope);
        return Object.keys(legacyFile).length ? [legacyFile] : [];
      })
      .filter((item) => item.attachmentId || item.name || item.relativePath || item.transferFilePath)
      .filter((item) => {
        const key =
          normalizeString(item.attachmentId) ||
          `${normalizeString(item.name)}|${normalizeString(item.relativePath)}|${normalizeString(item.transferFilePath)}`;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return transferFiles.length ? { transferFiles } : {};
  }

  const attachmentMetas = Array.isArray(payload?.attachmentMetas)
    ? payload.attachmentMetas.map(compactAttachmentMetaForModel).filter((item) => Object.keys(item).length)
    : [];
  return attachmentMetas.length ? { attachmentMetas } : {};
}

export function compactToolResultPayloadForModel(payload = {}) {
  if (!isPlainObject(payload)) return payload;
  const compactPayload = { ...payload };
  delete compactPayload.transferResult;
  delete compactPayload.transferEnvelope;
  delete compactPayload.transferEnvelopes;

  const transferPayload = compactTransferPayloadForModel(payload);
  if (transferPayload.transferFiles?.length) {
    delete compactPayload.attachmentMetas;
    compactPayload.transferFiles = transferPayload.transferFiles;
  } else if (transferPayload.attachmentMetas?.length) {
    compactPayload.attachmentMetas = transferPayload.attachmentMetas;
  }
  return compactObject(compactPayload);
}

export function compactToolResultTextForModel(toolResultText = "") {
  const raw = String(toolResultText || "");
  if (!raw.trim()) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return raw;
    return JSON.stringify(compactToolResultPayloadForModel(parsed));
  } catch {
    return raw;
  }
}
