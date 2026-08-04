/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { dispatchAgentTurn } from "../../../src/bot/execution/runner/agent-dispatch.js";
import { createCurrentTurnMessagesStore } from "../../../src/context/session/current-turn-store.js";

test("dispatchAgentTurn accepts completed-turn summary state into the canonical store", async () => {
  const events = [];
  const runtimeEventListener = {
    onEvent(event) { events.push(event); },
  };
  const dispatchRuntime = {
    currentTurnMessages: createCurrentTurnMessagesStore([{
      messageId: "sm_tool",
      messageUid: "sm_tool",
      role: "tool",
      type: "tool_result",
      content: "result",
      summarized: false,
    }]),
  };

  const result = await dispatchAgentTurn({
    agentRunner: async () => ({
      output: "done",
      assistantMessageId: "sm_final",
      traces: [],
      turnMessages: [
        {
          messageId: "sm_tool",
          messageUid: "sm_tool",
          role: "tool",
          type: "tool_result",
          content: "result",
          summarized: true,
        },
        {
          messageId: "sm_final",
          messageUid: "sm_final",
          role: "assistant",
          type: "message",
          content: "done",
          summarized: false,
        },
      ],
      turnTasks: [],
    }),
    errorLogger: null,
    lifecycle: { enterRunning() {} },
    dispatchRuntime,
    runtimeAgentContext: {
      payload: { messages: { history: [] } },
      execution: { controllers: { runtime: dispatchRuntime } },
    },
    abortSignal: null,
    normalizedMessage: { userId: "u1", content: "question" },
    currentUserMessage: {
      messageUid: "sm_user",
      role: "user",
      content: "question",
      dialogProcessId: "dp1",
      turnScopeId: "ts1",
    },
    userMessageAttachments: [],
    resolvedRunConfig: {},
    runtimeEventListener,
    botHookRuntime: {},
    botHookBase: {},
    agentContextSummary: {},
    usedSessionId: "s1",
    dialogProcessId: "dp1",
    resolvedTurnScopeId: "ts1",
    syncLifecycleRuntimeState() {},
  });

  assert.equal(result.turnMessages.find((message) => message.messageUid === "sm_tool")?.summarized, true);
  assert.equal(
    dispatchRuntime.currentTurnMessages.toArray()
      .find((message) => message.messageUid === "sm_tool")?.summarized,
    true,
  );
  const acceptedEvent = events.find(
    (event = {}) => event.event === "agent.contextIdentity.completedTurnSummaryAccepted",
  );
  assert.ok(acceptedEvent);
  assert.deepEqual(acceptedEvent.data.dispatchedSummarizedMessageIds, ["sm_tool"]);
  assert.deepEqual(acceptedEvent.data.acceptedSummarizedMessageIds, ["sm_tool"]);
});
