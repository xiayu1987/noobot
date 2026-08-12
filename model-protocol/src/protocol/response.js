/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_PROTOCOL_NAME, MODEL_PROTOCOL_VERSION, MODEL_REQUEST_STATUS } from "./constants.js";
import { MODEL_OPERATION_KIND, normalizeModelOperationResult } from "./operation.js";

function freezeAttempt(attempt = {}) {
  return Object.freeze({
    ...attempt,
    output:
      attempt.output && typeof attempt.output === "object"
        ? Object.freeze({ ...attempt.output })
        : undefined,
    error:
      attempt.error && typeof attempt.error === "object"
        ? Object.freeze({ ...attempt.error })
        : undefined,
  });
}

export function createModelResponse({
  invocation,
  output,
  attemptCount = 1,
  attempts = [],
  model = {},
  provider = {},
  result = {},
  operationKind = MODEL_OPERATION_KIND.CHAT,
} = {}) {
  const normalizedAttempts = Object.freeze(
    (Array.isArray(attempts) ? attempts : []).map(freezeAttempt),
  );
  return Object.freeze({
    protocol: MODEL_PROTOCOL_NAME,
    protocolVersion: MODEL_PROTOCOL_VERSION,
    status: MODEL_REQUEST_STATUS.COMPLETED,
    operationKind,
    invocation,
    output,
    result: normalizeModelOperationResult(operationKind, result),
    execution: Object.freeze({
      attemptCount,
      attempts: normalizedAttempts,
      model: Object.freeze({ ...model }),
      provider: Object.freeze({ ...provider }),
    }),
  });
}
