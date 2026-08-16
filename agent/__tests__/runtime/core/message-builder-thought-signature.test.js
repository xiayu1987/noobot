/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";

import { projectSessionRecordsToContextMessages as toConversationMessages } from "@noobot/context-protocol/session-message-projection";
import { buildContextMessages } from "../../../src/context/assembly/message-builder.js";
import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";

test("buildContextMessages preserves thought-signature payload/tool_calls and omits non-required kwargs", () => {
  const thoughtPayload = [
    {
      type: "text",
      text: "准备调用工具",
      thought_signature: "encrypted-thought-signature",
    },
  ];
  const history = toConversationMessages([
    {
      messageUid: "message-thought-signature",
      role: "assistant",
      content: "fallback text",
      rawModelContent: thoughtPayload,
      tool_calls: [
        {
          id: "call_task_summary",
          function: {
            name: "task_summary",
            arguments: "{}",
          },
        },
      ],
      modelAdditionalKwargs: {
        providerState: "opaque-signature-carrier",
      },
      modelResponseMetadata: {
        finish_reason: "tool_calls",
      },
      dialogProcessId: "dialog-thought-signature",
      turnScopeId: "turn-thought-signature",
    },
    {
      messageUid: "message-task-summary-result",
      role: "tool",
      content: '{"toolName":"task_summary","ok":true,"phaseSummary":"阶段小结"}',
      tool_call_id: "call_task_summary",
      dialogProcessId: "dialog-thought-signature",
      turnScopeId: "turn-thought-signature",
    },
  ]);
  const messages = buildContextMessages(
    createTestAgentExecutionScope(
      {
        systemRuntime: {
          sessionId: "session-thought-signature",
          dialogProcessId: "dialog-thought-signature",
          turnScopeId: "turn-thought-signature",
        },
      },
      { messageBlocks: { system: [], history } },
    ),
    { currentUserMessage: null },
  );

  const aiMessage = messages.find((messageItem) => messageItem instanceof AIMessage);
  assert.ok(aiMessage);
  assert.deepEqual(aiMessage.content, thoughtPayload);
  assert.equal(aiMessage.tool_calls?.[0]?.id, "call_task_summary");
  assert.equal(aiMessage.tool_calls?.[0]?.name, "task_summary");
  assert.deepEqual(aiMessage.additional_kwargs || {}, {
    noobotMessageId: "message-thought-signature",
    dialogProcessId: "dialog-thought-signature",
    turnScopeId: "turn-thought-signature",
  });
  assert.deepEqual(aiMessage.response_metadata || {}, {});
});
