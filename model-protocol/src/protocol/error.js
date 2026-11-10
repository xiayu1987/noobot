/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  createModelFailureClassification,
} from "./constants.js";

export class ModelProtocolError extends Error {
  constructor(
    message,
    {
      code = MODEL_ERROR_CODE.PROTOCOL,
      kind = MODEL_ERROR_KIND.PROTOCOL,
      cause,
      details = {},
    } = {},
  ) {
    super(message, { cause });
    this.name = "ModelProtocolError";
    this.code = code;
    this.kind = kind;
    this.retryable = createModelFailureClassification(kind).retryable;
    this.details = Object.freeze({ ...details });
  }
}
