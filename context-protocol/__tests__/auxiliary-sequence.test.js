/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceAuxiliaryModelContext,
  AUXILIARY_SEQUENCE_IDENTITY_FIELD,
  AUXILIARY_SEQUENCE_MESSAGE_KIND,
  declareAuxiliarySequenceIdentity,
  projectAuxiliaryMessagesForProvider,
} from "../src/assembly/auxiliary-sequence.js";

function context(message, id) {
  return declareAuxiliarySequenceIdentity(
    { ...message, messageUid: id },
    {
      kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT,
      key: id,
    },
  );
}

function stable(message, key) {
  return declareAuxiliarySequenceIdentity(message, {
    kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.STABLE_PROTOCOL,
    key,
  });
}

function request(content) {
  return declareAuxiliarySequenceIdentity(
    { role: "user", content },
    {
      kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.REQUEST,
    },
  );
}

function current(checkpointRevision, { system = [], history = [], incremental = [] } = {}) {
  return { checkpointRevision, messageBlocks: { system, history, incremental } };
}

test("auxiliary sequence establishes a baseline without an in-memory snapshot", () => {
  const transition = advanceAuxiliaryModelContext({
    currentContext: current(2, {
      system: [stable({ role: "system", content: "protocol" }, "protocol")],
      history: [context({ role: "user", content: "u1" }, "m1")],
      incremental: [request("request-1")],
    }),
  });
  assert.equal(transition.rebuilt, true);
  assert.equal(transition.snapshot.checkpointRevision, 2);
  assert.deepEqual(
    transition.messages.map((message) => message.content),
    ["protocol", "u1", "request-1"],
  );
});

test("auxiliary sequence appends canonical Context evidence and the current request", () => {
  const first = advanceAuxiliaryModelContext({
    currentContext: current(0, {
      system: [stable({ role: "system", content: "protocol" }, "protocol")],
      history: [context({ role: "user", content: "u1" }, "m1")],
      incremental: [request("request-1")],
    }),
  });
  const second = advanceAuxiliaryModelContext({
    previousSnapshot: first.snapshot,
    currentContext: current(0, {
      system: [stable({ role: "system", content: "protocol" }, "protocol")],
      history: [
        context({ role: "user", content: "u1" }, "m1"),
        context(
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call-1", function: { name: "read", arguments: "{}" } }],
          },
          "m2",
        ),
        context({ role: "tool", content: "result", tool_call_id: "call-1" }, "m3"),
      ],
      incremental: [request("request-2")],
    }),
  });
  assert.equal(second.rebuilt, false);
  assert.deepEqual(
    second.messages.map((message) => message.content),
    ["protocol", "u1", "request-1", "", "result", "request-2"],
  );
  assert.equal(second.messages[3].tool_calls[0].id, "call-1");
  assert.equal(second.messages[4].tool_call_id, "call-1");
});

test("auxiliary sequence rebuilds only from the authoritative context after checkpoint change", () => {
  const first = advanceAuxiliaryModelContext({
    currentContext: current(0, {
      history: [context({ role: "user", content: "old" }, "old")],
      incremental: [request("old request")],
    }),
  });
  const second = advanceAuxiliaryModelContext({
    previousSnapshot: first.snapshot,
    currentContext: current(1, {
      history: [context({ role: "user", content: "summary" }, "summary")],
      incremental: [request("new request")],
    }),
  });
  assert.equal(second.rebuilt, true);
  assert.deepEqual(
    second.messages.map((message) => message.content),
    ["summary", "new request"],
  );
});

test("auxiliary sequence rejects Context messages without canonical identity", () => {
  const unidentified = declareAuxiliarySequenceIdentity(
    { role: "user", content: "fact" },
    {
      kind: AUXILIARY_SEQUENCE_MESSAGE_KIND.CONTEXT,
      key: "claimed",
    },
  );
  assert.throws(
    () =>
      advanceAuxiliaryModelContext({
        currentContext: current(0, { history: [unidentified] }),
      }),
    /canonical messageUid\/noobotMessageId/,
  );
});

test("provider projection removes internal sequence identity", () => {
  const projected = projectAuxiliaryMessagesForProvider([
    context({ role: "user", content: "fact" }, "m1"),
  ]);
  assert.equal(projected[0][AUXILIARY_SEQUENCE_IDENTITY_FIELD], undefined);
  assert.deepEqual(Object.keys(projected[0]), ["role", "content"]);
});
