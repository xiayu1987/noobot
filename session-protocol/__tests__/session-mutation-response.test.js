/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMessageDeleteResponse,
  createTurnReplaceResponse,
  requireMessageDeleteResponse,
  requireTurnReplaceResponse,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
} from "../src/index.js";

function input(replace = false) {
  const commandId = replace ? "replace-1" : "delete-1";
  const committedAt = "2026-11-15T00:00:00.000Z";
  const turnReplacement = {
    protocolVersion: 1,
    eventType: "turn.replaced",
    commandId,
    sessionId: "s1",
    committedAggregateVersion: 4,
    replacedTurnScopeIds: ["old"],
    replacementDialogProcessId: "dialog-new",
    replacementTurnScopeId: "new",
    replacementUserMessageUid: "user-new",
    requestHash: "request-hash",
    committedAt,
  };
  const result = replace
    ? { turnReplacement }
    : {
        deletedCount: 1,
        anchorIndex: 2,
        deletedTurnScopeIds: [],
      };
  const message = {
    sessionId: "s1",
    parentSessionId: "",
    messageUid: "user-new",
    userMessageId: "um-new",
    role: "user",
    content: "edited",
    turnScopeId: "new",
    dialogProcessId: "dialog-new",
  };
  const projection = {
    kind: "commit",
    generation: 9,
    receipt: {
      commandId,
      type: replace ? SESSION_COMMAND.TURN_REPLACE : SESSION_COMMAND.MESSAGE_DELETE_FROM,
      requestHash: "request-hash",
      aggregateVersion: 4,
      committedAt,
      result,
    },
    baseAggregateVersion: 3,
    metadata: { sessionId: "s1", parentSessionId: "", aggregateVersion: 4 },
    lifecycleHead: { sequence: 5, activeTurnScopeId: "" },
    deletedMessageUids: ["removed"],
    messages: replace ? [{ ordinal: 3, turnOrdinal: 1, message }] : [],
    turns: [],
    replacements: [],
    timings: [],
  };
  return {
    receiptResult: result,
    commandId,
    committedAggregateVersion: 4,
    deduplicated: false,
    deletedMessageUids: ["removed"],
    sessionId: "s1",
    generation: 9,
    projection,
    displayMessages: replace ? [message] : [],
  };
}

for (const replace of [false, true]) {
  const create = replace ? createTurnReplaceResponse : createMessageDeleteResponse;
  const requireResponse = replace ? requireTurnReplaceResponse : requireMessageDeleteResponse;
  const label = replace ? "replacement" : "deletion";
  test(`${label} response carries original changes without a complete detail document`, () => {
    const response = create(input(replace));
    assert.equal(requireResponse(response), response);
    assert.equal(Object.hasOwn(response, "detail"), false);
    assert.deepEqual(response.deletedMessageUids, ["removed"]);
    assert.equal(response.projection.turns.length, 0);
  });
  test(`${label} retry preserves original effects while reporting a later generation`, () => {
    const source = input(replace);
    const response = create({ ...source, deduplicated: true, generation: 100 });
    assert.equal(response.projection.generation, 9);
    assert.equal(response.generation, 100);
    assert.deepEqual(response.displayMessages, source.displayMessages);
  });
  test(`${label} rejects mismatched identity, deletion evidence and generations`, () => {
    const response = create(input(replace));
    for (const changes of [
      { commandId: "other" },
      { sessionId: "other" },
      { committedAggregateVersion: 5 },
      { deletedMessageUids: ["other"] },
      { generation: 8 },
      { generation: 10 },
      { displayMessages: [null] },
      { detail: {} },
      { deduplicated: "yes" },
    ])
      assert.throws(() => requireResponse({ ...response, ...changes }), {
        code: SESSION_ERROR_CODE.SESSION_MUTATION_RESPONSE_INVALID,
      });
  });
  test(`${label} imported receipts cannot invent original effects`, () => {
    const source = input(replace);
    source.projection = { kind: "baseline", generation: 1, receipt: source.projection.receipt };
    const baseline = {
      ...source,
      deduplicated: true,
      deletedMessageUids: null,
      displayMessages: [],
    };
    assert.equal(create(baseline).projection.kind, "baseline");
    for (const changes of [
      { deduplicated: false },
      { deletedMessageUids: [] },
      { displayMessages: [{}] },
    ])
      assert.throws(() => create({ ...baseline, ...changes }), {
        code: SESSION_ERROR_CODE.SESSION_MUTATION_RESPONSE_INVALID,
      });
  });
}

test("replacement display content must match the original committed message", () => {
  const source = input(true);
  assert.throws(
    () =>
      createTurnReplaceResponse({
        ...source,
        displayMessages: [{ ...source.displayMessages[0], content: "later edit" }],
      }),
    { code: SESSION_ERROR_CODE.SESSION_MUTATION_RESPONSE_INVALID },
  );
});
