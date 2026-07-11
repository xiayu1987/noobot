/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function trimString(value = "") {
  return String(value || "").trim();
}

function pickOwner(owner = null) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return null;
  const picked = {};
  for (const key of ["type", "id", "source"]) {
    const value = owner?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) picked[key] = value;
  }
  return Object.keys(picked).length ? picked : null;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function compactRefFields(ref = {}) {
  const picked = {};
  const attachmentId = trimString(firstValue(ref.attachmentId, ref.attachment_id, ref.id, ref.fileId, ref.file_id));
  const clientAttachmentId = trimString(firstValue(ref.clientAttachmentId, ref.client_attachment_id));
  const mimeType = trimString(firstValue(ref.mimeType, ref.type, ref.mime));
  const attachmentSource = trimString(firstValue(ref.attachmentSource, ref.attachment_source, ref.source));
  const sessionId = trimString(firstValue(ref.sessionId, ref.session_id, ref.backendSessionId));
  const name = trimString(firstValue(ref.name, ref.fileName, ref.filename));
  const size = firstValue(ref.size, ref.bytes);
  const relativePath = trimString(firstValue(ref.relativePath, ref.relative_path));
  const sandboxPath = trimString(firstValue(ref.sandboxPath, ref.sandboxViewPath, ref.sandbox_path, ref.sandbox_view_path));
  const path = trimString(firstValue(ref.path, ref.filePath, ref.file_path));
  const generationSource = trimString(firstValue(ref.generationSource, ref.generation_source));
  const role = trimString(ref.role);
  const url = trimString(firstValue(ref.url, ref.downloadUrl));
  const previewUrl = trimString(ref.previewUrl);
  const sandboxFlag = typeof ref.isSandbox === "boolean" ? ref.isSandbox : ref.sandboxEnabled;
  const owner = pickOwner(ref.owner);
  const parsedResult = compactParsedResultRef(ref.parsedResult);

  if (attachmentId) {
    picked.attachmentId = attachmentId;
  }
  if (clientAttachmentId) picked.clientAttachmentId = clientAttachmentId;
  if (name) picked.name = name;
  if (mimeType) {
    picked.mimeType = mimeType;
  }
  if (size !== "" && Number.isFinite(Number(size))) picked.size = Number(size);
  if (attachmentSource) {
    picked.attachmentSource = attachmentSource;
  }
  if (sessionId) picked.sessionId = sessionId;
  if (relativePath) picked.relativePath = relativePath;
  if (sandboxPath) picked.sandboxPath = sandboxPath;
  if (path) picked.path = path;
  if (generationSource) picked.generationSource = generationSource;
  if (owner) picked.owner = owner;
  if (parsedResult) picked.parsedResult = parsedResult;
  if (role) picked.role = role;
  if (url) picked.url = url;
  if (previewUrl) picked.previewUrl = previewUrl;
  if (typeof sandboxFlag === "boolean") picked.isSandbox = sandboxFlag === true;
  return picked;
}

function compactParsedResultRef(parsedResult = null) {
  if (!parsedResult || typeof parsedResult !== "object" || Array.isArray(parsedResult)) return null;
  const picked = {};
  const attachmentId = trimString(firstValue(parsedResult.attachmentId, parsedResult.id));
  const name = trimString(firstValue(parsedResult.name, parsedResult.fileName, parsedResult.filename));
  const path = trimString(firstValue(parsedResult.path, parsedResult.filePath, parsedResult.file_path));
  const relativePath = trimString(firstValue(parsedResult.relativePath, parsedResult.relative_path));
  const tool = trimString(parsedResult.tool);
  const status = trimString(parsedResult.status);
  const updatedAt = trimString(firstValue(parsedResult.updatedAt, parsedResult.updated_at));
  const mimeType = trimString(firstValue(parsedResult.mimeType, parsedResult.type, parsedResult.mime));
  const sandboxFlag = typeof parsedResult.isSandbox === "boolean" ? parsedResult.isSandbox : parsedResult.sandboxEnabled;

  if (attachmentId) picked.attachmentId = attachmentId;
  if (name) picked.name = name;
  if (path) picked.path = path;
  if (relativePath) picked.relativePath = relativePath;
  if (tool) picked.tool = tool;
  if (status) picked.status = status;
  if (updatedAt) picked.updatedAt = updatedAt;
  if (mimeType) picked.mimeType = mimeType;
  if (typeof sandboxFlag === "boolean") picked.isSandbox = sandboxFlag === true;
  return Object.keys(picked).length ? picked : null;
}

export function compactAttachmentRef(...sources) {
  // Session summaries are a display/edit-back carrier, not a place to rebuild
  // attachment truth from raw transport payloads.  Keep the canonical addressing
  // and parsed-result fields compactly so the frontend can still derive preview
  // and download actions after resend/session-detail reloads.
  const merged = {};
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    Object.assign(merged, source);
  }
  const picked = compactRefFields(merged);
  return Object.keys(picked).length ? picked : null;
}

export function compactTransferFileRef(file = {}, envelope = {}) {
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const fileMeta = file?.attachmentMeta;
  const filePathView = file?.pathView;
  return compactAttachmentRef(
    file,
    fileMeta,
    filePathView,
    {
      role: file?.role,
      path: firstValue(fileMeta?.path, file?.path, file?.filePath),
      relativePath: firstValue(fileMeta?.relativePath, file?.relativePath, filePathView?.relativePath),
      sandboxPath: firstValue(fileMeta?.sandboxPath, fileMeta?.sandboxViewPath, file?.sandboxPath, file?.sandboxViewPath, filePathView?.sandboxPath),
      isSandbox: firstValue(fileMeta?.isSandbox, file?.isSandbox, filePathView?.isSandbox),
    },
  );
}

export function compactTransferEnvelope(envelope = {}) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const picked = {};
  for (const key of [
    "protocol",
    "version",
    "direction",
    "transport",
    "id",
    "type",
    "from",
    "to",
    "status",
    "state",
    "title",
    "label",
    "createdAt",
    "updatedAt",
  ]) {
    const value = envelope?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (["string", "number", "boolean"].includes(typeof value)) picked[key] = value;
  }
  const files = (Array.isArray(envelope?.files) ? envelope.files : [])
    .slice(0, 50)
    .map((item) => compactTransferFileRef(item, envelope))
    .filter(Boolean);
  if (files.length) picked.files = dedupeAttachmentRefs(files);
  return Object.keys(picked).length ? picked : null;
}

export function compactTransferEnvelopes(envelopes = []) {
  const seen = new Set();
  return (Array.isArray(envelopes) ? envelopes : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => compactTransferEnvelope(item))
    .filter(Boolean)
    .filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function collectAttachmentRefsFromTransferEnvelopes(envelopes = []) {
  return compactTransferEnvelopes(envelopes).flatMap((envelope = {}) =>
    Array.isArray(envelope?.files) ? envelope.files : [],
  );
}

export function dedupeAttachmentRefs(refs = []) {
  const seen = new Set();
  return (Array.isArray(refs) ? refs : [])
    .map((item) => compactAttachmentRef(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.attachmentId
        ? `id:${item.attachmentId}`
        : JSON.stringify({
          name: item.name || "",
          path: item.path || "",
          relativePath: item.relativePath || "",
          sandboxPath: item.sandboxPath || "",
        });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
