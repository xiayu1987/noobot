/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_ATTEMPT_KIND,
  MODEL_ATTEMPT_STATUS,
  MODEL_PROTOCOL_NAME,
  MODEL_PROTOCOL_VERSION,
  MODEL_REQUEST_STATUS,
} from "./constants.js";
import { MODEL_OPERATION_KIND, normalizeModelOperationResult } from "./operation.js";
import { MODEL_ADAPTER_ID } from "../model/model-adapter.js";

const MODEL_ATTEMPT_STATUSES = new Set(Object.values(MODEL_ATTEMPT_STATUS));
const MODEL_ATTEMPT_KINDS = new Set(Object.values(MODEL_ATTEMPT_KIND));
const MODEL_ADAPTER_IDS = new Set(Object.values(MODEL_ADAPTER_ID));

export function normalizeModelExecutionProvider(provider = {}) {
  const adapterId = String(provider?.adapterId || "").trim();
  if (!MODEL_ADAPTER_IDS.has(adapterId)) {
    throw new TypeError(`invalid model execution adapter id: ${adapterId || "missing"}`);
  }
  const operatorId = String(provider?.operatorId || "").trim();
  if (!operatorId) {
    throw new TypeError("model execution provider requires operatorId");
  }
  return Object.freeze({ adapterId, operatorId });
}

export function requireModelAttemptStatus(value) {
  const normalized = String(value || "").trim();
  if (!MODEL_ATTEMPT_STATUSES.has(normalized)) {
    throw new TypeError(`invalid model attempt status: ${normalized || "missing"}`);
  }
  return normalized;
}

export function requireModelAttemptKind(value) {
  const normalized = String(value || "").trim();
  if (!MODEL_ATTEMPT_KINDS.has(normalized)) {
    throw new TypeError(`invalid model attempt kind: ${normalized || "missing"}`);
  }
  return normalized;
}

function freezeAttempt(attempt = {}) {
  return Object.freeze({
    ...attempt,
    status: requireModelAttemptStatus(attempt.status),
    kind: requireModelAttemptKind(attempt.kind),
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
      provider: normalizeModelExecutionProvider(provider),
    }),
  });
}
