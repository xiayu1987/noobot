/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTransferEnvelope, directInput, directOutput, fileInput, fileOutput, isTransferEnvelope } from "./envelope.js";
import { TRANSFER_DIRECTION, TRANSFER_TRANSPORT } from "../core/constants.js";

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
    void runtime;
    void agentContext;
    if (Object.prototype.hasOwnProperty.call(value, "content")) {
      return makeDirect(value.content, valueMeta);
    }
  }

  return makeDirect(value == null ? "" : String(value), meta);
}
