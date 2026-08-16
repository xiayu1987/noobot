/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const ATTACHMENT_LIFECYCLE = Object.freeze({
  RECEIVED: "received",
  PERSISTED: "persisted",
  PARSING: "parsing",
  PARSED: "parsed",
  GENERATED: "generated",
  INVALID: "invalid",
  DELETED: "deleted",
});
export const ATTACHMENT_EVENT_TYPE = Object.freeze({
  RECEIVED: "attachment.received",
  PERSISTED: "attachment.persisted",
  PARSE_STARTED: "attachment.parse_started",
  PARSED: "attachment.parsed",
  GENERATED: "attachment.generated",
  INVALID: "attachment.invalid",
  DELETED: "attachment.deleted",
});
export const ATTACHMENT_EVENT_STATUS = Object.freeze({
  [ATTACHMENT_EVENT_TYPE.RECEIVED]: ATTACHMENT_LIFECYCLE.RECEIVED,
  [ATTACHMENT_EVENT_TYPE.PERSISTED]: ATTACHMENT_LIFECYCLE.PERSISTED,
  [ATTACHMENT_EVENT_TYPE.PARSE_STARTED]: ATTACHMENT_LIFECYCLE.PARSING,
  [ATTACHMENT_EVENT_TYPE.PARSED]: ATTACHMENT_LIFECYCLE.PARSED,
  [ATTACHMENT_EVENT_TYPE.GENERATED]: ATTACHMENT_LIFECYCLE.GENERATED,
  [ATTACHMENT_EVENT_TYPE.INVALID]: ATTACHMENT_LIFECYCLE.INVALID,
  [ATTACHMENT_EVENT_TYPE.DELETED]: ATTACHMENT_LIFECYCLE.DELETED,
});
const ALLOWED = Object.freeze({
  received: new Set(["persisted", "invalid", "deleted"]),
  generated: new Set(["persisted", "invalid", "deleted"]),
  persisted: new Set(["parsing", "invalid", "deleted"]),
  parsing: new Set(["parsed", "invalid", "deleted"]),
  parsed: new Set(["deleted"]),
  invalid: new Set(["deleted"]),
  deleted: new Set(),
});
export function isTerminalAttachmentLifecycle(s) {
  return s === ATTACHMENT_LIFECYCLE.DELETED;
}
export function canTransitionAttachmentLifecycle(current, next) {
  return current === undefined || current === next || ALLOWED[current]?.has(next) === true;
}
