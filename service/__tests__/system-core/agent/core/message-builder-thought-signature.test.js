import test from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";

import { toConversationMessages } from "../../../../system-core/context/data-providers.js";
import { buildContextMessages } from "../../../../system-core/agent/core/context/message-builder.js";

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
    },
  ]);
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  const aiMessage = messages.find((messageItem) => messageItem instanceof AIMessage);
  assert.ok(aiMessage);
  assert.deepEqual(aiMessage.content, thoughtPayload);
  assert.equal(aiMessage.tool_calls?.[0]?.id, "call_task_summary");
  assert.equal(aiMessage.tool_calls?.[0]?.name, "task_summary");
  assert.deepEqual(aiMessage.additional_kwargs || {}, {});
  assert.deepEqual(aiMessage.response_metadata || {}, {});
});
