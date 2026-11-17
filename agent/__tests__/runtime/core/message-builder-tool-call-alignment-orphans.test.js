/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";

import { buildContextMessageBlocks } from "../../../src/context/assembly/message-builder.js";

import { createTestAgentExecutionScope } from "../../helpers/agent-execution-scope.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { createPersistedCurrentUserMessage } from "./message-builder-current-user-fixture.js";

function sessionContextHistory(records) {
  return records.map((record) =>
    projectSessionRecordToContextMessage({ messageUid: createMessageUid(), ...record }),
  );
}

test("buildContextMessageBlocks drops orphan tool results without matching assistant tool_call", () => {
  const messages = buildContextMessageBlocks(
    createTestAgentExecutionScope(createTestRuntimeContext(), {
      messageBlocks: {
        system: [],
        history: sessionContextHistory([
          {
            role: "user",
            content: "q-1",
            dialogProcessId: "dlg-tool",
          },
          {
            role: "assistant",
            content: "",
            dialogProcessId: "dlg-tool",
            tool_calls: [
              {
                id: "call_ok_1",
                function: {
                  name: "read_file",
                  arguments: "{}",
                },
              },
            ],
          },
          {
            role: "tool",
            content: '{"ok":true}',
            tool_call_id: "call_ok_1",
            dialogProcessId: "dlg-tool",
          },
          {
            role: "tool",
            content: '{"ok":true}',
            tool_call_id: "call_orphan_1",
            dialogProcessId: "dlg-tool",
          },
          {
            role: "assistant",
            content: "final",
            dialogProcessId: "dlg-tool",
          },
        ]),
        incremental: [],
      },
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("current") },
  ).messages;

  const toolMessages = messages.filter((item) => item instanceof ToolMessage);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "call_ok_1");
});

test("buildContextMessageBlocks preserves migrated summary messages without a tool recovery path", () => {
  const summaryContent = "完整阶段小结正文";
  const messages = buildContextMessageBlocks(
    createTestAgentExecutionScope(createTestRuntimeContext(), {
      messageBlocks: {
        system: [],
        history: sessionContextHistory([
          {
            role: "user",
            content: "q-summary",
            dialogProcessId: "dlg-summary",
          },
          {
            role: "user",
            type: "message",
            content: summaryContent,
            injectedMessage: true,
            injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
            dialogProcessId: "dlg-summary",
            turnScopeId: "turn-summary",
          },
          {
            role: "assistant",
            content: "done",
            dialogProcessId: "dlg-summary",
          },
        ]),
        incremental: [],
      },
    }),
    { currentUserMessage: createPersistedCurrentUserMessage("current") },
  ).messages;

  assert.equal(
    messages.some((item) => item instanceof ToolMessage),
    false,
  );
  const humanMessage = messages.find(
    (item) =>
      item instanceof HumanMessage &&
      item.additional_kwargs?.injectedMessageType ===
        CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  );
  assert.ok(humanMessage);
  assert.equal(humanMessage.content, summaryContent);
});
