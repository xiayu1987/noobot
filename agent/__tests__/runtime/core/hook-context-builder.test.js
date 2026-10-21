/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";
import { HOOK_POINT, HOOK_PROTOCOL_VERSION } from "@noobot/hook-protocol";
import { buildHookContext } from "../../../src/runtime/hooks/hook-context-builder.js";

test("before_final_output retains the supplied authoritative modelContext entity", () => {
  const modelContext = createModelContext({
    messageBlocks: {
      system: [],
      history: [
        writeContextMessageMetadata(
          { role: "user", content: "history" },
          { messageUid: createMessageUid() },
        ),
      ],
      incremental: [
        writeContextMessageMetadata(
          { role: "assistant", content: "final" },
          { messageUid: createMessageUid() },
        ),
      ],
    },
  });
  const context = buildHookContext(
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
    {},
    {
      modelContext,
      result: { output: "final" },
    },
  );

  assert.equal(context.contextProtocolVersion, HOOK_PROTOCOL_VERSION);
  assert.equal(context.modelContext, modelContext);
  assert.equal(Object.hasOwn(context, "messages"), false);
  assert.equal(Object.hasOwn(context, "messageBlocks"), false);
  assert.equal(Object.hasOwn(context, "messageStore"), false);
  assert.deepEqual(
    context.modelContext.messages.map((message) => message.content),
    ["history", "final"],
  );
});

test("non-model hook context uses the canonical runtime turn identity and diagnostics leave identity to the route", () => {
  const events = [];
  const modelContext = createModelContext({
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        writeContextMessageMetadata(
          { role: "user", content: "active turn" },
          { messageUid: createMessageUid() },
        ),
      ],
    },
  });
  const runtime = {
    activeMessageContext: modelContext,
    systemRuntime: {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "d1",
      turnScopeId: "t1",
    },
    eventListener: { onEvent: (event) => events.push(event) },
  };

  const context = buildHookContext(HOOK_POINT.AGENT.BEFORE_TOOL_CALL, runtime, {
    call: { name: "read_file", args: {} },
  });

  assert.equal(context.dialogProcessId, "d1");
  assert.equal(context.turnScopeId, "t1");
  assert.equal(context.modelContext, modelContext);
  const diagnostic = events.find(
    (event) => event.event === "agent.contextProtocol.hookDocumentConsumed",
  );
  for (const field of [
    "userId",
    "sessionId",
    "parentSessionId",
    "dialogProcessId",
    "turnScopeId",
  ]) {
    assert.equal(Object.hasOwn(diagnostic.data, field), false, field);
  }
  assert.equal(diagnostic.data.hasModelContext, true);
  assert.equal(diagnostic.data.modelContextProtocolVersion, modelContext.protocolVersion);
});
