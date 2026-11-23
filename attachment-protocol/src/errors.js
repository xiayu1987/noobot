/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const ATTACHMENT_METADATA_ERROR_CODE = Object.freeze({
  MISSING: "ATTACHMENT_METADATA_MISSING",
  UNREADABLE: "ATTACHMENT_METADATA_UNREADABLE",
});

export const ATTACHMENT_BODY_ERROR_CODE = Object.freeze({
  UNAVAILABLE: "ATTACHMENT_BODY_UNAVAILABLE",
});

export class AttachmentProtocolError extends Error {
  constructor(code, details = {}, options) {
    super(code, options);
    this.name = "AttachmentProtocolError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
