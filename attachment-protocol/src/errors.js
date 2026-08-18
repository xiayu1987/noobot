/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export class AttachmentProtocolError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AttachmentProtocolError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
