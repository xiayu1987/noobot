/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { APIError, APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from "openai";
import { MODEL_ERROR_KIND, createModelFailureClassification } from "@noobot/model-protocol";
import { classifyProviderError } from "./provider-error-classification.js";

const RESPONSES_FAILURE_ERROR_NAME = "ResponsesStreamFailedError";

export function createResponsesFailureError({ code, message }) {
  const error = new Error(message);
  error.name = RESPONSES_FAILURE_ERROR_NAME;
  error.code = code;
  error.providerFailure = true;
  return error;
}

export function classifyOpenAiError(error, context) {
  if (error instanceof APIUserAbortError)
    return createModelFailureClassification(MODEL_ERROR_KIND.ABORTED);
  if (error instanceof APIConnectionTimeoutError) {
    return createModelFailureClassification(MODEL_ERROR_KIND.TIMEOUT);
  }
  if (error instanceof APIError && !(error instanceof APIConnectionError))
    return classifyProviderError(
      {
        providerFailure: true,
        status: error.status,
        code: error.code,
        type: error.type,
        details: error.error?.details,
        headers: error.headers,
      },
      context,
    );
  return classifyProviderError(error, context);
}
