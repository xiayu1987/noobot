/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const ATTACHMENT_PROTOCOL_NAME = "noobot.attachment";
export const ATTACHMENT_PROTOCOL_VERSION = 1;

export class AttachmentProtocolError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AttachmentProtocolError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requirePlainObject(value, code) {
  if (!isPlainObject(value)) throw new AttachmentProtocolError(code);
  return value;
}

export function requireNonEmptyString(value, code) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new AttachmentProtocolError(code);
  }
  return value;
}

export function optionalNonEmptyString(value, code) {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, code);
}

export function optionalBoolean(value, code) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new AttachmentProtocolError(code);
  return value;
}

export function optionalNonNegativeInteger(value, code) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new AttachmentProtocolError(code);
  return value;
}

export function assertKnownFields(value, allowedFields, codePrefix) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new AttachmentProtocolError(`${codePrefix}:${key}`, { field: key });
    }
  }
}

export function freezeDefined(value) {
  return Object.freeze(Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ));
}
