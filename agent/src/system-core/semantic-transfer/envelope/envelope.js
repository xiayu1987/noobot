/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_DIRECTION,
  TRANSFER_PROTOCOL,
  TRANSFER_TRANSPORT,
  TRANSFER_VERSION,
} from "../core/constants.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (Array.isArray(value)) {
    const list = value
      .map((item) => cleanValue(item))
      .filter((item) => item !== undefined);
    return list.length ? list : undefined;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, childValue] of Object.entries(value)) {
      const normalized = cleanValue(childValue);
      if (normalized !== undefined) out[key] = normalized;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

function cleanMeta(meta = {}) {
  const normalized = cleanValue(meta);
  return isPlainObject(normalized) ? normalized : {};
}

function normalizeDirection(value = TRANSFER_DIRECTION.OUTPUT) {
  const normalized = String(value || "").trim();
  return normalized === TRANSFER_DIRECTION.INPUT || normalized === TRANSFER_DIRECTION.OUTPUT
    ? normalized
    : TRANSFER_DIRECTION.OUTPUT;
}

function normalizeTransport(value = TRANSFER_TRANSPORT.DIRECT) {
  const normalized = String(value || "").trim();
  return normalized === TRANSFER_TRANSPORT.DIRECT || normalized === TRANSFER_TRANSPORT.FILE
    ? normalized
    : TRANSFER_TRANSPORT.DIRECT;
}

export function createTransferEnvelope({
  direction = TRANSFER_DIRECTION.OUTPUT,
  transport = TRANSFER_TRANSPORT.DIRECT,
  content = undefined,
  filePath = "",
  attachmentMeta = null,
  files = [],
  pathView = null,
  storage = null,
  producer = null,
  meta = {},
} = {}) {
  const normalizedDirection = normalizeDirection(direction);
  const normalizedTransport = normalizeTransport(transport);
  const envelope = {
    protocol: TRANSFER_PROTOCOL,
    version: TRANSFER_VERSION,
    direction: normalizedDirection,
    transport: normalizedTransport,
  };
  if (content !== undefined) envelope.content = content;
  const normalizedFilePath = String(filePath || "").trim();
  if (normalizedFilePath) envelope.filePath = normalizedFilePath;
  if (isPlainObject(attachmentMeta)) envelope.attachmentMeta = attachmentMeta;
  const normalizedFiles = Array.isArray(files)
    ? files.map((item) => cleanMeta(item)).filter((item) => Object.keys(item).length)
    : [];
  if (normalizedFiles.length) envelope.files = normalizedFiles;
  const normalizedPathView = cleanMeta(pathView);
  if (Object.keys(normalizedPathView).length) envelope.pathView = normalizedPathView;
  const normalizedStorage = cleanMeta(storage);
  if (Object.keys(normalizedStorage).length) envelope.storage = normalizedStorage;
  const normalizedProducer = cleanMeta(producer);
  const normalizedMeta = cleanMeta({
    mimeType: DEFAULT_TRANSFER_MIME_TYPE,
    ...meta,
    ...(Object.keys(normalizedProducer).length ? { producer: normalizedProducer } : {}),
  });
  if (Object.keys(normalizedMeta).length) envelope.meta = normalizedMeta;
  return envelope;
}

export function isTransferEnvelope(value = null) {
  return (
    isPlainObject(value) &&
    value.protocol === TRANSFER_PROTOCOL &&
    Number(value.version) === TRANSFER_VERSION &&
    (value.direction === TRANSFER_DIRECTION.INPUT || value.direction === TRANSFER_DIRECTION.OUTPUT) &&
    (value.transport === TRANSFER_TRANSPORT.DIRECT || value.transport === TRANSFER_TRANSPORT.FILE)
  );
}

export function directInput(content, meta = {}) {
  return createTransferEnvelope({
    direction: TRANSFER_DIRECTION.INPUT,
    transport: TRANSFER_TRANSPORT.DIRECT,
    content,
    meta,
  });
}

export function fileInput(filePath = "", attachmentMeta = null, meta = {}) {
  return createTransferEnvelope({
    direction: TRANSFER_DIRECTION.INPUT,
    transport: TRANSFER_TRANSPORT.FILE,
    filePath,
    attachmentMeta,
    meta,
  });
}

export function directOutput(content, meta = {}) {
  return createTransferEnvelope({
    direction: TRANSFER_DIRECTION.OUTPUT,
    transport: TRANSFER_TRANSPORT.DIRECT,
    content,
    meta,
  });
}

export function fileOutput(filePath = "", attachmentMeta = null, meta = {}) {
  return createTransferEnvelope({
    direction: TRANSFER_DIRECTION.OUTPUT,
    transport: TRANSFER_TRANSPORT.FILE,
    filePath,
    attachmentMeta,
    meta,
  });
}
