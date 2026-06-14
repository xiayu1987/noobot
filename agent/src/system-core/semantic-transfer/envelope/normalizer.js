/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTransferEnvelope, directInput, directOutput, fileInput, fileOutput, isTransferEnvelope } from "./envelope.js";
import { TRANSFER_DIRECTION, TRANSFER_TRANSPORT } from "../core/constants.js";
import { firstNormalizedString } from "../core/compact.js";
import { buildTransferFileEntry, resolveTransferFilePath } from "../storage/path-resolver.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTransfer(value, {
  direction = TRANSFER_DIRECTION.OUTPUT,
  runtime = {},
  agentContext = null,
  meta = {},
} = {}) {
  if (isTransferEnvelope(value)) return value;
  const normalizedDirection = String(direction || TRANSFER_DIRECTION.OUTPUT).trim();
  const makeDirect = normalizedDirection === TRANSFER_DIRECTION.INPUT ? directInput : directOutput;
  const makeFile = normalizedDirection === TRANSFER_DIRECTION.INPUT ? fileInput : fileOutput;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return makeDirect(String(value), meta);
  }

  if (isPlainObject(value)) {
    const valueMeta = { ...meta, ...(isPlainObject(value.meta) ? value.meta : {}) };
    const attachmentMetas = Array.isArray(value.attachmentMetas)
      ? value.attachmentMetas.filter(isPlainObject)
      : [];
    if (attachmentMetas.length) {
      const files = attachmentMetas.map((attachmentMeta, index) =>
        buildTransferFileEntry({
          runtime,
          agentContext,
          attachmentMeta,
          purpose: "normalize_transfer_file_path",
          role: index === 0 ? "primary" : "secondary",
        }),
      );
      const firstFile = files[0] || {};
      const firstMeta = attachmentMetas[0] || null;
      return createTransferEnvelope({
        direction: normalizedDirection,
        transport: TRANSFER_TRANSPORT.FILE,
        filePath: firstFile.filePath || "",
        attachmentMeta: firstMeta,
        files,
        pathView: firstFile.pathView || null,
        storage: isPlainObject(value.storage) ? value.storage : null,
        producer: isPlainObject(value.producer) ? value.producer : null,
        meta: valueMeta,
      });
    }

    const attachmentMeta = isPlainObject(value.attachmentMeta) ? value.attachmentMeta : value;
    const explicitPath = firstNormalizedString(value.filePath, value.path, value.relativePath);
    if (explicitPath || attachmentMeta?.path || attachmentMeta?.relativePath) {
      const transferPath = firstNormalizedString(explicitPath, attachmentMeta?.path);
      const transferRelativePath = firstNormalizedString(attachmentMeta?.relativePath);
      const filePath = resolveTransferFilePath({
        runtime,
        agentContext,
        attachmentMeta,
        path: transferPath,
        relativePath: transferRelativePath,
        purpose: "normalize_transfer_file_path",
      });
      const file = buildTransferFileEntry({
        runtime,
        agentContext,
        attachmentMeta,
        path: transferPath,
        relativePath: transferRelativePath,
        purpose: "normalize_transfer_file_path",
      });
      return createTransferEnvelope({
        direction: normalizedDirection,
        transport: TRANSFER_TRANSPORT.FILE,
        filePath,
        attachmentMeta,
        files: [file],
        pathView: file.pathView || null,
        storage: isPlainObject(value.storage) ? value.storage : null,
        producer: isPlainObject(value.producer) ? value.producer : null,
        meta: valueMeta,
      });
    }
    if (Object.prototype.hasOwnProperty.call(value, "content")) {
      return makeDirect(value.content, valueMeta);
    }
  }

  return makeDirect(value == null ? "" : String(value), meta);
}
