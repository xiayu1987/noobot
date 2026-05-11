import test from "node:test";
import assert from "node:assert/strict";

import { ContextBuilder } from "../../../system-core/context/index.js";

function createBuilderForNormalizationTest() {
  return new ContextBuilder({
    config: {
      globalConfig: {},
      userConfig: {},
    },
    serviceContainer: {
      sessionManager: null,
      memoryService: null,
      attachmentService: null,
      skillService: null,
      eventListener: null,
      botManager: null,
      userInteractionBridge: null,
    },
    sessionContext: {
      userId: "u1",
      sessionId: "s1",
      caller: "user",
      parentSessionId: "",
      attachmentMetas: [],
      runConfig: {},
      abortSignal: null,
      parentAsyncResultContainer: null,
    },
  });
}

test("_normalizeSessionRecordsForConversation filters summarized and orphan tool results", () => {
  const builder = createBuilderForNormalizationTest();
  const input = [
    { role: "assistant", content: "summarized", summarized: true },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_1",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "orphan_call",
    },
  ];

  const result = builder._normalizeSessionRecordsForConversation(input);
  assert.equal(result.some((messageItem) => messageItem?.summarized === true), false);
  assert.equal(
    result.some(
      (messageItem) =>
        messageItem?.role === "tool" &&
        String(messageItem?.tool_call_id || "") === "orphan_call",
    ),
    false,
  );
});
