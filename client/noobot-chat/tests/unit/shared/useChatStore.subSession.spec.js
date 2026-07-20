import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../src/shared/stores/useChatStore.js";

describe("sub-session realtime message projection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps assistant thinking when a tool result arrives", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      turnScopeId: "workflow-node:execution-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "execution-1",
    };

    store.upsertSubSessionEvent("thinking_delta", {
      ...identity,
      eventId: "thinking-1",
      sequence: 1,
      role: "assistant",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
    });
    store.upsertSubSessionEvent("tool_result", {
      ...identity,
      eventId: "tool-result-1",
      sequence: 2,
      role: "tool",
      toolCallId: "call-1",
      content: "tool completed",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    });

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: "assistant",
      thinking: "```mermaid\ngraph TD; A-->B\n```",
      content: "",
      toolResult: { tool_call_id: "call-1", output: "ok" },
    });
    expect(session.messages[0].rawEvents).toHaveLength(2);
  });

  it("does not attach a tool event to an assistant from another turn", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("thinking_delta", {
      sessionId: "child-session",
      turnScopeId: "turn-1",
      eventId: "thinking-1",
      role: "assistant",
      thinking: "planning",
    });
    store.upsertSubSessionEvent("tool_result", {
      sessionId: "child-session",
      turnScopeId: "turn-2",
      eventId: "tool-2",
      role: "tool",
      toolCallId: "call-2",
      content: "result",
    });

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].thinking).toBe("planning");
  });
});
