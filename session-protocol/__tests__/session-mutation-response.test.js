/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  TURN_RECOVERY_ACTION,
  createMessageDeleteResponse,
  createSessionDetailDocument,
  createTurnLifecycleSnapshot,
  createTurnReplaceResponse,
  createTurnReplacementCommit,
  requireMessageDeleteResponse,
  requireTurnReplaceResponse,
} from "../src/index.js";

const INVALID = { code: SESSION_ERROR_CODE.SESSION_MUTATION_RESPONSE_INVALID };

function snapshot(sessionId) {
  return createTurnLifecycleSnapshot({
    commandId: `snapshot-${sessionId}`,
    sessionId,
    sequence: 0,
    activeTurnScopeId: "",
    activeTurn: null,
    recentTerminalTurns: [],
    replacedTurns: [],
    unchanged: false,
    recovery: TURN_RECOVERY_ACTION.NONE,
    generatedAt: "2026-01-02T00:00:00.000Z",
  });
}

function detail({ aggregateVersion, messages, sessionId = "s-1" }) {
  return createSessionDetailDocument({
    sessionId,
    sessions: [
      {
        sessionId,
        parentSessionId: "",
        caller: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        title: sessionId,
        aggregateVersion,
        turnTimings: [],
        turnLifecycleSnapshot: snapshot(sessionId),
        sessionArtifactEvents: [],
        messages,
        availability: "available",
      },
    ],
  });
}

function unavailableDetail() {
  return createSessionDetailDocument({
    sessionId: "s-1",
    sessions: [
      {
        sessionId: "s-1",
        parentSessionId: "",
        caller: "user",
        availability: "unavailable",
        unavailableReason: { code: "SESSION_ARTIFACT_NOT_FOUND", message: "missing" },
      },
    ],
  });
}

function deleteInput(overrides = {}) {
  return {
    receiptResult: { deletedCount: 2, anchorIndex: 1, deletedTurnScopeIds: ["turn-old"] },
    commandId: "delete-1",
    committedAggregateVersion: 4,
    deduplicated: false,
    detail: detail({
      aggregateVersion: 4,
      messages: [{ role: "user", messageUid: "user-keep", turnScopeId: "turn-keep" }],
    }),
    ...overrides,
  };
}

function commit(overrides = {}) {
  return createTurnReplacementCommit({
    commandId: "resend-1",
    sessionId: "s-1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["turn-old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "turn-new",
    replacementUserMessageUid: "user-new",
    requestHash: "request-hash-1",
    committedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  });
}

const REPLACEMENT_USER = {
  role: "user",
  messageUid: "user-new",
  dialogProcessId: "dialog-new",
  turnScopeId: "turn-new",
};

const REPLACEMENT_ASSISTANT = {
  role: "assistant",
  messageUid: "assistant-new",
  dialogProcessId: "dialog-new",
  turnScopeId: "turn-new",
};

function replaceInput(overrides = {}) {
  return {
    receiptResult: { turnReplacement: commit() },
    commandId: "resend-1",
    committedAggregateVersion: 4,
    deduplicated: false,
    detail: detail({ aggregateVersion: 4, messages: [REPLACEMENT_USER] }),
    ...overrides,
  };
}

test("message delete response is the command result plus one detail document", () => {
  const response = createMessageDeleteResponse(deleteInput());
  assert.deepEqual(Object.keys(response).sort(), [
    "anchorIndex",
    "commandId",
    "committedAggregateVersion",
    "deduplicated",
    "deletedCount",
    "deletedTurnScopeIds",
    "detail",
  ]);
  assert.equal(requireMessageDeleteResponse(response), response);
});

test("mutation responses reject internal aggregate fields and a missing detail", () => {
  const response = createMessageDeleteResponse(deleteInput());
  for (const extra of ["session", "aggregateVersion", "removedAuthorityOutboxEvents"]) {
    assert.throws(() => requireMessageDeleteResponse({ ...response, [extra]: 1 }), INVALID);
  }
  const { detail: _detail, ...withoutDetail } = response;
  assert.throws(() => requireMessageDeleteResponse(withoutDetail), INVALID);
});

test("mutation response detail must exist and its main entry must be available", () => {
  const missing = { exists: false, sessionId: "s-1", sessions: [] };
  assert.throws(() => createMessageDeleteResponse(deleteInput({ detail: missing })), INVALID);
  assert.throws(
    () => createMessageDeleteResponse(deleteInput({ detail: unavailableDetail() })),
    INVALID,
  );
});

test("detail version equals the committed version for a new commit and may exceed it when deduplicated", () => {
  const ahead = detail({ aggregateVersion: 5, messages: [] });
  assert.throws(() => createMessageDeleteResponse(deleteInput({ detail: ahead })), INVALID);
  assert.doesNotThrow(() =>
    createMessageDeleteResponse(deleteInput({ detail: ahead, deduplicated: true })),
  );
  const behind = detail({ aggregateVersion: 3, messages: [] });
  assert.throws(
    () => createMessageDeleteResponse(deleteInput({ detail: behind, deduplicated: true })),
    INVALID,
  );
});

test("turn replace response binds the replacement user to the detail main entry", () => {
  const response = createTurnReplaceResponse(replaceInput());
  assert.deepEqual(Object.keys(response).sort(), [
    "commandId",
    "committedAggregateVersion",
    "deduplicated",
    "detail",
    "turnReplacement",
  ]);
  assert.equal(requireTurnReplaceResponse(response), response);
});

test("turn replace response rejects a detail that does not match the commit", () => {
  const cases = {
    replaced_scope_still_present: [
      REPLACEMENT_USER,
      { role: "user", messageUid: "user-old", turnScopeId: "turn-old" },
    ],
    assistant_in_replacement_scope: [REPLACEMENT_USER, REPLACEMENT_ASSISTANT],
    wrong_dialog_process: [{ ...REPLACEMENT_USER, dialogProcessId: "dialog-other" }],
    missing_replacement_user: [],
  };
  for (const [name, messages] of Object.entries(cases)) {
    assert.throws(
      () =>
        createTurnReplaceResponse(
          replaceInput({ detail: detail({ aggregateVersion: 4, messages }) }),
        ),
      INVALID,
      name,
    );
  }
});

test("turn replace response rejects identity drift between envelope, commit and detail", () => {
  assert.throws(
    () => createTurnReplaceResponse(replaceInput({ commandId: "resend-other" })),
    INVALID,
  );
  assert.throws(
    () => createTurnReplaceResponse(replaceInput({ committedAggregateVersion: 5 })),
    INVALID,
  );
  assert.throws(
    () =>
      createTurnReplaceResponse(
        replaceInput({
          detail: detail({
            sessionId: "s-other",
            aggregateVersion: 4,
            messages: [REPLACEMENT_USER],
          }),
        }),
      ),
    INVALID,
  );
});

test("deduplicated replace response tolerates later messages in the replacement scope", () => {
  const input = replaceInput({
    deduplicated: true,
    detail: detail({ aggregateVersion: 6, messages: [REPLACEMENT_USER, REPLACEMENT_ASSISTANT] }),
  });
  assert.doesNotThrow(() => createTurnReplaceResponse(input));
  assert.throws(
    () =>
      createTurnReplaceResponse({
        ...input,
        detail: detail({ aggregateVersion: 6, messages: [] }),
      }),
    INVALID,
  );
});
