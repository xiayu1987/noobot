/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_ERROR_CODE, MODEL_ERROR_KIND } from "./constants.js";

export class ModelProtocolError extends Error {
  constructor(
    message,
    {
      code = MODEL_ERROR_CODE.PROTOCOL,
      kind = MODEL_ERROR_KIND.UNKNOWN,
      retryable = false,
      cause,
      details = {},
    } = {},
  ) {
    super(message, { cause });
    this.name = "ModelProtocolError";
    this.code = code;
    this.kind = kind;
    this.retryable = retryable === true;
    this.details = Object.freeze({ ...details });
  }
}
