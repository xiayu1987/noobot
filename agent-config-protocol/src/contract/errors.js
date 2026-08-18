/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONFIG_ERROR_CODE = Object.freeze({
  INVALID_DOCUMENT: "INVALID_CONFIG_DOCUMENT",
  INVALID_PARAM_DOCUMENT: "INVALID_CONFIG_PARAM_DOCUMENT",
  UNSUPPORTED_VERSION: "UNSUPPORTED_CONFIG_VERSION",
  UNRESOLVED_TEMPLATE: "UNRESOLVED_CONFIG_TEMPLATE",
  VALIDATION_FAILED: "CONFIG_VALIDATION_FAILED",
});

export class AgentConfigProtocolError extends Error {
  constructor(message, { code = CONFIG_ERROR_CODE.INVALID_DOCUMENT, details = {} } = {}) {
    super(message);
    this.name = "AgentConfigProtocolError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
