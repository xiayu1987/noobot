/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isTransferEnvelope } from "./envelope.js";
import { buildTransferFileEntry } from "./path-resolver.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

export function getTransferFiles(value = null, { runtime = {}, agentContext = null } = {}) {
  if (!value) return [];
  if (isTransferEnvelope(value)) {
    if (Array.isArray(value.files) && value.files.length) {
      return value.files.filter(isPlainObject);
    }
    if (value.filePath || value.attachmentMeta) {
      return [
        {
          filePath: normalizeString(value.filePath),
          ...(isPlainObject(value.attachmentMeta) ? { attachmentMeta: value.attachmentMeta } : {}),
          ...(isPlainObject(value.pathView) ? { pathView: value.pathView } : {}),
          role: "primary",
        },
      ];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .filter(isPlainObject)
      .map((attachmentMeta, index) =>
        buildTransferFileEntry({
          runtime,
          agentContext,
          attachmentMeta,
          role: index === 0 ? "primary" : "secondary",
          purpose: "consume_transfer_files",
        }),
      );
  }
  if (isPlainObject(value)) {
    if (Array.isArray(value.files) && value.files.length) return value.files.filter(isPlainObject);
    if (Array.isArray(value.attachmentMetas) && value.attachmentMetas.length) {
      return getTransferFiles(value.attachmentMetas, { runtime, agentContext });
    }
    if (value.filePath || value.path || value.relativePath || value.attachmentMeta) {
      const attachmentMeta = isPlainObject(value.attachmentMeta) ? value.attachmentMeta : value;
      return [
        buildTransferFileEntry({
          runtime,
          agentContext,
          attachmentMeta,
          path: value.filePath || value.path || attachmentMeta?.path || "",
          relativePath: value.relativePath || attachmentMeta?.relativePath || "",
          purpose: "consume_transfer_files",
        }),
      ];
    }
  }
  return [];
}

export function getPrimaryTransferFile(value = null, options = {}) {
  return getTransferFiles(value, options)[0] || null;
}

export function getTransferDisplayPath(value = null, options = {}) {
  const file = getPrimaryTransferFile(value, options);
  if (!file) return "";
  return normalizeString(
    file?.pathView?.displayPath ||
      file?.filePath ||
      file?.pathView?.sandboxPath ||
      file?.pathView?.relativePath ||
      file?.pathView?.hostPath ||
      file?.attachmentMeta?.sandboxPath ||
      file?.attachmentMeta?.sandboxViewPath ||
      file?.attachmentMeta?.relativePath ||
      file?.attachmentMeta?.path ||
      file?.attachmentMeta?.name,
  );
}

export function getTransferAttachmentMetas(value = null) {
  if (!value) return [];
  if (isTransferEnvelope(value)) {
    const fromFiles = Array.isArray(value.files)
      ? value.files.map((item = {}) => item?.attachmentMeta).filter(isPlainObject)
      : [];
    if (fromFiles.length) return fromFiles;
    return isPlainObject(value.attachmentMeta) ? [value.attachmentMeta] : [];
  }
  if (Array.isArray(value)) {
    const list = value.filter(isPlainObject);
    const hasEnvelope = list.some((item = {}) => isTransferEnvelope(item));
    if (hasEnvelope) {
      return list.flatMap((item) => getTransferAttachmentMetas(item));
    }
    return list;
  }
  if (isPlainObject(value)) {
    if (Array.isArray(value.attachmentMetas)) return value.attachmentMetas.filter(isPlainObject);
    if (Array.isArray(value.files)) {
      return value.files.map((item = {}) => item?.attachmentMeta).filter(isPlainObject);
    }
    if (isPlainObject(value.attachmentMeta)) return [value.attachmentMeta];
  }
  return [];
}
