/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { captureSessionTransactionInput } from "@noobot/session-protocol/session-changes";
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
    messages: [],
    ...overrides,
  };
}

const invalidCode = { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID };

test("checkpoint source requires exact ordered canonical UIDs before commit", () => {
  const source = { ...request(), checkpointMessages: [{ messageUid: "message" }] };
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

test("checkpoint source accepts changes without expanding committed turn messages", () => {
  assert.doesNotThrow(() =>
    assertSummaryCheckpointSource({
      ...request({ persistedMessageUids: [], summarizedMessageUids: ["committed"] }),
      checkpointMessages: [],
    }),
  );
});

test("checkpoint identity binds ordered canonical facts to the predecessor revision", () => {
  const parsed = parseTurnSummaryCheckpointRequest(request());
  assert.equal(
    createSummaryCheckpointId(parsed),
    createSummaryCheckpointId(
      parseTurnSummaryCheckpointRequest(request({ checkpointId: "retry" })),
    ),
  );
  assert.notEqual(
    createSummaryCheckpointId(parsed),
    createSummaryCheckpointId(
      parseTurnSummaryCheckpointRequest(request({ expectedCheckpointRevision: 1 })),
    ),
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

test("checkpoint replacement cannot disappear from its request or retry identity", () => {
  const replacement = {
    messageUid: "message",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    expectedContentReference: `sha256:${"a".repeat(64)}`,
    owner: 1,
    content: "",
  };
  const parse = (write) =>
    parseTurnSummaryCheckpointRequest(request({ messageContentReplacements: [write] }));
  const parsed = parse(replacement);
  assert.deepEqual(parsed.messageContentReplacements, [replacement]);
  assert.notEqual(parsed.requestHash, parseTurnSummaryCheckpointRequest(request()).requestHash);
  assert.notEqual(parsed.requestHash, parse({ ...replacement, content: "different" }).requestHash);
  assert.throws(() => parse({ ...replacement, turnScopeId: "other" }), invalidCode);
  assert.throws(() => parse({ ...replacement, messageUid: "other" }), invalidCode);
  assert.throws(
    () =>
      parseTurnSummaryCheckpointRequest(
        request({
          messageContentReplacements: [replacement],
          messageContentAppends: [{ ...replacement, content: "suffix" }],
        }),
      ),
    TypeError,
  );
});

test("checkpoint facts are strict JSON and exclude runtime options without changing the historical digest", () => {
  const parsed = parseTurnSummaryCheckpointRequest(request());
  const withOptions = parseTurnSummaryCheckpointRequest(
    request({ persistenceContext: { resolve: () => {} }, submission: { submit: () => {} } }),
  );
  assert.deepEqual(withOptions, parsed);
  assert.ok(!Object.hasOwn(parsed, "persistenceContext"));
  assert.ok(!Object.hasOwn(parsed, "submission"));
  assert.equal(
    parsed.requestHash,
    "sha256:51d970f81f258b32736a5691db2b6c952e9388dabf32089010b6fe67e2c1cbc8",
  );
  assert.deepEqual(captureSessionTransactionInput({ summaryCheckpoints: [parsed] }), {
    summaryCheckpoints: [parsed],
  });
});

test("checkpoint requests reject missing payload, coercion, duplicate and malformed UIDs", () => {
  assert.equal(
    parseTurnSummaryCheckpointRequest(
      request({ expectedCheckpointRevision: Number.MAX_SAFE_INTEGER - 1 }),
    ).expectedCheckpointRevision,
    Number.MAX_SAFE_INTEGER - 1,
  );
  for (const payload of [null, undefined, [], 1]) {
    assert.throws(() => parseTurnSummaryCheckpointRequest(payload), invalidCode);
  }
  for (const expectedCheckpointRevision of [
    -1,
    0.5,
    "0",
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => parseTurnSummaryCheckpointRequest(request({ expectedCheckpointRevision })),
      invalidCode,
    );
    assert.throws(
      () => createSummaryCheckpointId(request({ expectedCheckpointRevision })),
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

test("checkpoint message changes require exact ownership and participate in retry identity", () => {
  const message = {
    messageUid: "message",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    content: "first",
  };
  const first = parseTurnSummaryCheckpointRequest(request({ messages: [message] }));
  const second = parseTurnSummaryCheckpointRequest(
    request({ messages: [{ ...message, content: "edited" }] }),
  );
  assert.notEqual(first.requestHash, second.requestHash);
  for (const messages of [
    undefined,
    null,
    {},
    [null],
    [message, message],
    [{ ...message, messageUid: "outside" }],
    [{ ...message, dialogProcessId: "other" }],
    [{ ...message, turnScopeId: "other" }],
  ]) {
    assert.throws(() => parseTurnSummaryCheckpointRequest(request({ messages })), invalidCode);
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
