/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  requireWorkflowSessionRequest,
  WORKFLOW_SESSION_REQUEST_ERROR_CODE,
} from "../src/workflow-session-detail.js";

const requests = {
  detail: { userId: "user-1", sessionId: "root-1", dialogProcessId: "dialog-1" },
  "thinking-detail": {
    userId: "user-1",
    sessionId: "root-1",
    routeDialogProcessId: "node-dialog",
    dialogProcessId: "turn-dialog",
    turnScopeId: "turn-1",
  },
  "execution-report": {
    userId: "user-1",
    sessionId: "root-1",
    routeDialogProcessId: "node-dialog",
    dialogProcessId: "turn-dialog",
  },
};

for (const [operation, request] of Object.entries(requests)) {
  test(`${operation} preserves canonical request identities and rejects unknown fields`, () => {
    assert.equal(requireWorkflowSessionRequest(request, operation), request);
    assert.throws(
      () => requireWorkflowSessionRequest({ ...request, childSessionId: "other" }, operation),
      { code: WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID, statusCode: 400 },
    );
  });
  test(`${operation} rejects missing, empty and non-canonical identities without mutating input`, () => {
    for (const field of Object.keys(request)) {
      for (const value of [undefined, "", " leading", "trailing ", null, 1, ["duplicate"]]) {
        const input = { ...request, [field]: value };
        const before = structuredClone(input);
        const turnLookup =
          operation === "thinking-detail" && ["dialogProcessId", "turnScopeId"].includes(field);
        const code = turnLookup
          ? SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID
          : value === undefined
            ? WORKFLOW_SESSION_REQUEST_ERROR_CODE.REQUIRED
            : WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID;
        assert.throws(() => requireWorkflowSessionRequest(input, operation), {
          code,
          statusCode: 400,
        });
        assert.deepEqual(input, before);
      }
    }
  });
}

test("detail trace is optional but an explicit trace must be canonical", () => {
  assert.equal(
    requireWorkflowSessionRequest({ ...requests.detail, traceId: "trace-1" }, "detail").traceId,
    "trace-1",
  );
  for (const traceId of ["", " trace", null, []]) {
    assert.throws(() => requireWorkflowSessionRequest({ ...requests.detail, traceId }, "detail"), {
      code: WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID,
      statusCode: 400,
    });
  }
});
