/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import { validateEventEnvelope } from "./envelope.js";
import {
  WORKFLOW_RUNTIME_EVENT,
  validateWorkflowRuntimeEnvelope,
} from "./workflow-runtime-event.js";

export function requireWorkflowDetailIdentity(value, field) {
  if (!isCanonicalText(value)) {
    throw new TypeError(`invalid workflow detail identity: ${field}`);
  }
  return value;
}

export const WORKFLOW_SESSION_REQUEST_ERROR_CODE = Object.freeze({
  INVALID: "WORKFLOW_SESSION_REQUEST_INVALID",
  REQUIRED: "WORKFLOW_SESSION_REQUEST_REQUIRED",
});

const REQUEST_FIELDS = Object.freeze({
  detail: ["userId", "sessionId", "dialogProcessId", "traceId"],
  "thinking-detail": [
    "userId",
    "sessionId",
    "routeDialogProcessId",
    "dialogProcessId",
    "turnScopeId",
  ],
  "execution-report": ["userId", "sessionId", "routeDialogProcessId", "dialogProcessId"],
});

function requestError(message, code) {
  return Object.assign(new TypeError(message), { code, statusCode: 400 });
}

export function requireWorkflowSessionRequest(request, operation) {
  if (!Object.hasOwn(REQUEST_FIELDS, operation))
    throw new TypeError("unknown workflow session request operation");
  const fields = REQUEST_FIELDS[operation];
  if (!isPlainObject(request) || Object.keys(request).some((field) => !fields.includes(field))) {
    throw requestError(
      "invalid workflow session request fields",
      WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID,
    );
  }
  if (operation === "thinking-detail") requireTurnLookupKey(request);
  for (const field of fields) {
    if (field === "traceId" && request[field] === undefined) continue;
    if (!isCanonicalText(request[field])) {
      const code =
        request[field] === undefined
          ? WORKFLOW_SESSION_REQUEST_ERROR_CODE.REQUIRED
          : WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID;
      throw requestError(`invalid workflow session request identity: ${field}`, code);
    }
  }
  return request;
}

function requireMatchingFact(actual, expected, field) {
  if (actual !== expected) {
    throw new TypeError(`workflow session detail mismatch: ${field}`);
  }
}

export function requireWorkflowSessionDetail(
  detail,
  { sessionId, authoritySessionId, dialogProcessId },
) {
  requireWorkflowDetailIdentity(sessionId, "sessionId");
  requireWorkflowDetailIdentity(authoritySessionId, "authoritySessionId");
  requireWorkflowDetailIdentity(dialogProcessId, "dialogProcessId");
  if (!isPlainObject(detail)) throw new TypeError("workflowSession must be an object");
  if (Object.keys(detail).some((field) => !["snapshotEnvelope", "executionLogs"].includes(field))) {
    throw new TypeError("unknown workflow session detail field");
  }
  const { snapshotEnvelope, executionLogs } = detail;
  const envelopeValidation = validateEventEnvelope(snapshotEnvelope);
  const workflowValidation = validateWorkflowRuntimeEnvelope(snapshotEnvelope);
  if (
    !envelopeValidation.valid ||
    !workflowValidation.valid ||
    snapshotEnvelope.identity.eventType !== WORKFLOW_RUNTIME_EVENT.SESSION_SNAPSHOT
  ) {
    throw new TypeError(
      `invalid workflow session snapshot: ${[...envelopeValidation.errors, ...workflowValidation.errors].join(",")}`,
    );
  }
  const { payload, identity } = snapshotEnvelope;
  if (!Array.isArray(executionLogs)) {
    throw new TypeError("workflow session detail requires executionLogs");
  }
  requireMatchingFact(identity.sessionId, authoritySessionId, "authoritySessionId");
  requireMatchingFact(payload.nodeSessionId, sessionId, "nodeSessionId");
  requireMatchingFact(payload.dialogProcessId, dialogProcessId, "dialogProcessId");
  return detail;
}
