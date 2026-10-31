/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  assertSummaryCheckpointDisposition,
  assertSummaryCheckpointSource,
  assertSummaryCheckpointTargetsTurn,
  createSummaryCheckpointId,
  parseTurnSummaryCheckpointRequest,
} from "../src/policy/summary-checkpoint-request.js";

function request(overrides = {}) {
  return {
    userId: "user",
    sessionId: "session",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    checkpointId: "checkpoint",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["message"],
    summarizedMessageUids: ["message"],
    retainedMessageUids: [],
    ...overrides,
  };
}

const invalidCode = { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID };

test("checkpoint source requires exact ordered canonical UIDs before commit", () => {
  const source = { ...request(), turnMessages: [{ messageUid: "message" }] };
  assert.doesNotThrow(() => assertSummaryCheckpointSource(source));
  for (const overrides of [
    { persistedMessageUids: ["other"] },
    { persistedMessageUids: [] },
    { persistedMessageUids: ["message", "message"] },
    { summarizedMessageUids: [] },
  ]) {
    assert.throws(() => assertSummaryCheckpointSource({ ...source, ...overrides }), invalidCode);
  }
});

test("checkpoint identity and request hash use the same ordered canonical facts", () => {
  const parsed = parseTurnSummaryCheckpointRequest(request());
  assert.equal(
    createSummaryCheckpointId(parsed),
    `summary_checkpoint_${parsed.requestHash.slice(7, 39)}`,
  );
  assert.equal(
    parseTurnSummaryCheckpointRequest(request({ checkpointId: "retry" })).requestHash,
    parsed.requestHash,
  );
  assert.notEqual(
    parseTurnSummaryCheckpointRequest(request({ summarizedMessageUids: [] })).requestHash,
    parsed.requestHash,
  );
});

test("checkpoint requests reject missing payload, coercion, duplicate and malformed UIDs", () => {
  for (const payload of [null, undefined, [], 1]) {
    assert.throws(() => parseTurnSummaryCheckpointRequest(payload), invalidCode);
  }
  for (const expectedCheckpointRevision of [-1, 0.5, "0", NaN]) {
    assert.throws(
      () => parseTurnSummaryCheckpointRequest(request({ expectedCheckpointRevision })),
      invalidCode,
    );
  }
  for (const field of ["persistedMessageUids", "summarizedMessageUids", "retainedMessageUids"]) {
    for (const values of [null, "message", [""], [" message"], ["message", "message"]]) {
      assert.throws(
        () => parseTurnSummaryCheckpointRequest(request({ [field]: values })),
        invalidCode,
      );
    }
  }
});

test("checkpoint scope rejects ownership conflicts and inactive turns", () => {
  assert.throws(
    () =>
      assertSummaryCheckpointTargetsTurn(
        {
          turnLifecycle: {
            turns: { turn: { dialogProcessId: "other" } },
            activeTurnScopeId: "turn",
          },
        },
        request(),
      ),
    { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT },
  );
  assert.throws(
    () =>
      assertSummaryCheckpointTargetsTurn(
        {
          turnLifecycle: {
            turns: {},
            activeTurnScopeId: "other",
          },
        },
        request(),
      ),
    { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE },
  );
  assert.doesNotThrow(() =>
    assertSummaryCheckpointTargetsTurn(
      {
        turnLifecycle: {
          turns: { turn: { dialogProcessId: "dialog", state: "running" } },
          activeTurnScopeId: "turn",
        },
      },
      request(),
    ),
  );
});

test("checkpoint disposition rejects overlap and retained UIDs outside persisted messages", () => {
  assert.throws(
    () => assertSummaryCheckpointDisposition(request({ retainedMessageUids: ["message"] })),
    {
      code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT,
    },
  );
  assert.throws(
    () => assertSummaryCheckpointDisposition(request({ retainedMessageUids: ["missing"] })),
    {
      code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING,
    },
  );
  assert.doesNotThrow(() => assertSummaryCheckpointDisposition(request()));
});
