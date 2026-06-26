/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  TRANSFER_DIRECTION,
  TRANSFER_PROTOCOL,
  TRANSFER_STORAGE_KIND,
  TRANSFER_TRANSPORT,
  TRANSFER_VERSION,
} from "../core/constants.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateTransferEnvelope(value = null, { strict = false } = {}) {
  const errors = [];
  if (!isPlainObject(value)) {
    errors.push("envelope must be an object");
  } else {
    if (value.protocol !== TRANSFER_PROTOCOL) errors.push("invalid protocol");
    if (Number(value.version) !== TRANSFER_VERSION) errors.push("invalid version");
    if (!Object.values(TRANSFER_DIRECTION).includes(value.direction)) errors.push("invalid direction");
    if (!Object.values(TRANSFER_TRANSPORT).includes(value.transport)) errors.push("invalid transport");
    if (value.transport === TRANSFER_TRANSPORT.DIRECT && value.content === undefined) {
      errors.push("direct transport requires content");
    }
    if (value.transport === TRANSFER_TRANSPORT.FILE) {
      const hasFiles = Array.isArray(value.files) && value.files.length > 0;
      if (!hasFiles) {
        errors.push("file transport requires canonical files");
      }
      if (Array.isArray(value.files)) {
        value.files.forEach((file, index) => {
          if (!isPlainObject(file)) errors.push(`files[${index}] must be an object`);
        });
      }
    }
    if (value.storage !== undefined) {
      if (!isPlainObject(value.storage)) errors.push("storage must be an object");
      const kind = String(value.storage?.kind || "").trim();
      if (kind && !Object.values(TRANSFER_STORAGE_KIND).includes(kind)) {
        errors.push("invalid storage.kind");
      }
    }
    if (value.meta !== undefined && !isPlainObject(value.meta)) errors.push("meta must be an object");
  }
  const ok = errors.length === 0;
  if (!ok && strict) {
    throw new Error(`invalid transfer envelope: ${errors.join("; ")}`);
  }
  return { ok, errors };
}

export function isValidTransferEnvelope(value = null) {
  return validateTransferEnvelope(value).ok;
}
