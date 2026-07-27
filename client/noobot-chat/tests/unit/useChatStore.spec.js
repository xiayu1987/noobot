/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../src/shared/stores/useChatStore";
import { applyExecutionTree } from "../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

function createSubSessionEvent(overrides = {}) {
  const eventType = overrides.eventType || (
    overrides.toolResult ? "tool_call_end" :
      overrides.toolCall ? "tool_call_start" :
        overrides.thinking ? "thinking" :
          String(overrides.status || "") ? "message_status" : "llm_delta"
  );
  return {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 1,
    sessionId: "sub-session-1",
    parentSessionId: "main-session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    workflowRunId: "workflow-1",
    nodeExecutionId: "node-1",
    sequence: 1,
    revision: 1,
    eventId: "event-1",
    messageId: "msg-assistant-1",
    eventType,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useChatStore sub session projection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
  });

  it("keeps sub session projection isolated from main session storage", () => {
    const store = useChatStore();
    const result = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ content: "hello" }));

    expect(result.applied).toBe(true);
    expect(store.sessions).toEqual([]);
    expect(store.selectSubSessionMessages("sub-session-1")).toMatchObject({
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
    });
  });

  it("applies strict eventId dedupe for repeated realtime events", () => {
    const store = useChatStore();
    const first = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ content: "he" }));
    const second = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ content: "llo" }));

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toHaveLength(1);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[0].content).toBe("he");
  });

  it("converges workflow child streaming and non-streaming content on the final event", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("llm_delta", createSubSessionEvent({
      eventId: "delta-1", sequence: 1, eventType: "llm_delta", text: "draft ",
    }));
    store.upsertSubSessionEvent("llm_delta", createSubSessionEvent({
      eventId: "delta-2", sequence: 2, eventType: "llm_delta", text: "tokens",
    }));
    store.upsertSubSessionEvent("main_model_content", createSubSessionEvent({
      eventId: "final-3", sequence: 3, eventType: "main_model_content",
      text: "authoritative final", output: "authoritative final",
    }));

    const message = store.selectSubSessionMessages("sub-session-1")?.messages?.[0];
    expect(message).toMatchObject({
      content: "authoritative final",
      finalContentSequence: 3,
      messageId: "msg-assistant-1",
    });
  });

  it("merges delta, thinking, tool and lifecycle updates in sequence order", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "he", pending: true, status: "sending" }));
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-2", sequence: 2, content: "llo" }));
    store.upsertSubSessionEvent("subagent_thinking", createSubSessionEvent({
      eventId: "event-3",
      sequence: 3,
      thinking: { steps: ["plan"] },
      content: "",
    }));
    store.upsertSubSessionEvent("subagent_tool_call", createSubSessionEvent({
      eventId: "event-4",
      sequence: 4,
      toolCall: { name: "search" },
      content: "",
    }));
    store.upsertSubSessionEvent("subagent_tool_result", createSubSessionEvent({
      eventId: "event-5",
      sequence: 5,
      toolResult: { output: "ok" },
      content: "",
    }));
    store.upsertSubSessionEvent("turn_lifecycle", createSubSessionEvent({
      eventId: "event-6",
      sequence: 6,
      status: "completed",
      content: "",
    }));

    const session = store.selectSubSessionMessages("sub-session-1");
    expect(session?.messages).toHaveLength(1);
    expect(session?.messages[0]).toMatchObject({ content: "hello", thinking: { steps: ["plan"] }, status: "completed", pending: true });
    expect(session?.messages[0]).toMatchObject({ toolCall: { name: "search" }, toolResult: { output: "ok" } });
    expect(session?.turnStatuses).toEqual([expect.objectContaining({ turnScopeId: "turn-1", status: "completed" })]);
    expect(session?.turnTimings).toEqual([expect.objectContaining({ turnScopeId: "turn-1", thinkingFinishedAt: expect.any(String) })]);
    expect(session?.sequence).toBe(6);
    expect(session?.revision).toBe(1);
  });

  it("projects canonical backend tool envelopes into the assistant tool timeline", () => {
    const store = useChatStore();
    const started = store.upsertSubSessionEvent("tool_call_start", createSubSessionEvent({
      eventType: "tool_call_start",
      eventId: "tool-start-1",
      sequence: 1,
      tool: "read_file",
      args: { filePath: "notes.txt" },
      toolCallId: "call-1",
    }));
    const ended = store.upsertSubSessionEvent("tool_call_end", createSubSessionEvent({
      eventType: "tool_call_end",
      eventId: "tool-end-1",
      sequence: 2,
      tool: "read_file",
      result: "file body",
      success: true,
      toolCallId: "call-1",
    }));

    expect(started.applied).toBe(true);
    expect(ended.applied).toBe(true);
    const message = store.selectSubSessionMessages("sub-session-1")?.messages?.[0];
    expect(message?.role).toBe("assistant");
    expect(message?.toolCall).toEqual({
      id: "call-1",
      name: "read_file",
      args: { filePath: "notes.txt" },
    });
    expect(message?.toolResult).toEqual({
      toolCallId: "call-1",
      name: "read_file",
      output: "file body",
      success: true,
    });
    expect(message?.rawEvents).toHaveLength(2);
  });

  it("continues a REST-hydrated child session with realtime assistant tool events", () => {
    const store = useChatStore();
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      messages: [{
        id: "msg-user-1",
        messageId: "msg-user-1",
        role: "user",
        content: "run child task",
        sessionId: "sub-session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      }],
    });

    const result = store.upsertSubSessionEvent("tool_call_start", createSubSessionEvent({
      eventType: "tool_call_start",
      eventId: "tool-start-after-refresh",
      sequence: 1,
      tool: "write_file",
      toolCallId: "call-after-refresh",
    }));

    expect(result.applied).toBe(true);
    const messages = store.selectSubSessionMessages("sub-session-1")?.messages || [];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]).toMatchObject({
      id: "msg-assistant-1",
      sessionId: "sub-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      role: "assistant",
    });
    expect(messages[1].rawEvents).toHaveLength(1);
  });

  it("lets a canonical event take over a REST assistant shell without creating a duplicate", () => {
    const store = useChatStore();
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [{
        id: "persisted-shell-id",
        role: "assistant",
        content: "",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
      }],
    });

    const result = store.upsertSubSessionEvent("llm_delta", createSubSessionEvent({
      eventId: "canonical-event-1",
      messageId: "canonical-message-1",
      sequence: 1,
      content: "answer",
    }));

    expect(result.applied).toBe(true);
    expect(store.selectSubSessionMessages("sub-session-1").messages).toEqual([
      expect.objectContaining({
        id: "canonical-message-1",
        messageId: "canonical-message-1",
        role: "assistant",
        content: "answer",
      }),
    ]);
  });

  it("keeps canonical Assistant identity when a stale REST shell arrives after realtime", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("llm_delta", createSubSessionEvent({
      eventId: "canonical-event-1",
      messageId: "canonical-message-1",
      sequence: 1,
      content: "answer",
    }));

    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [{
        id: "persisted-shell-id",
        role: "assistant",
        content: "",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
      }],
    });

    expect(store.selectSubSessionMessages("sub-session-1").messages).toEqual([
      expect.objectContaining({
        id: "canonical-message-1",
        messageId: "canonical-message-1",
        content: "answer",
      }),
    ]);
  });

  it("keeps events ordered when realtime updates arrive out of sequence", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-2", sequence: 2, content: "second" }));
    const earlier = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "first" }));

    expect(earlier.applied).toBe(false);
    expect(earlier.reason).toBe("stale");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages.map((message) => message.content)).toEqual(["second"]);
  });

  it("rejects a message-event cursor declared for another message scope", () => {
    const store = useChatStore();
    const result = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({
      sequenceDomain: "message-event",
      sequenceScopeId: "different-message",
      content: "must not apply",
    }));

    expect(result).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_message_event",
      errors: ["sequence_scope_mismatch"],
    });
    expect(store.selectSubSessionMessages("sub-session-1")).toBeNull();
  });

  it("does not treat an unscoped snapshot sequence as message-event ordering", () => {
    const store = useChatStore();
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [{
        id: "msg-assistant-1",
        messageId: "msg-assistant-1",
        role: "assistant",
        content: "persisted",
        turnScopeId: "turn-1",
        sequence: 999,
        revision: 999,
      }],
    });

    const result = store.upsertSubSessionEvent("llm_delta", createSubSessionEvent({
      eventId: "event-live-1",
      sequence: 1,
      revision: 1,
      content: " live",
    }));

    expect(result.applied).toBe(true);
    expect(store.selectSubSessionMessages("sub-session-1").messages[0]).toMatchObject({
      sequence: 1,
      revision: 1,
      sequenceDomain: "message-event",
    });
  });

  it("merges a persisted snapshot without erasing realtime increments", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }));
    const snapshot = store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      status: "processing",
      messages: [
        { id: "msg-assistant-1", role: "assistant", content: "hello", sequence: 1 },
        { id: "msg-2", role: "assistant", content: "world", sequence: 2 },
      ],
    });

    expect(snapshot.applied).toBe(true);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toHaveLength(2);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[0].content).toBe("hello");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[1].content).toBe("world");
    expect(store.selectSubSessionMessages("sub-session-1")?.eventsById?.["event-1"]).toBeTruthy();
  });

  it("deduplicates id-less REST and realtime messages by child turn and role", () => {
    const store = useChatStore();
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [{
        role: "user",
        content: "same request",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
      }],
    });

    const result = store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [{
        role: "user",
        content: "same request",
        turnScopeId: "turn-1",
        dialogProcessId: "dialog-1",
      }],
    });

    expect(result.session.messages).toHaveLength(1);
    expect(result.session.messages[0]).toMatchObject({ role: "user", content: "same request" });
  });

  it("projects terminal workflow node state onto the isolated child session", () => {
    const store = useChatStore();
    store.upsertWorkflowNodeStateEvent({
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      status: "running",
      revision: 1,
      sequence: 1,
    });
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      status: "running",
      messages: [{ role: "user", content: "request", turnScopeId: "turn-1" }],
    });
    store.upsertWorkflowNodeStateEvent({
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-1",
      sessionId: "sub-session-1",
      parentSessionId: "main-session-1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      status: "succeeded",
      revision: 2,
      sequence: 2,
    });

    const session = store.selectSubSessionMessages("sub-session-1");
    expect(session.status).toBe("succeeded");
    expect(session.turnStatuses).toEqual([
      expect.objectContaining({ turnScopeId: "turn-1", status: "succeeded" }),
    ]);
    expect(session.turnTimings[0].thinkingFinishedAt).toEqual(expect.any(String));
  });

  it("does not overwrite existing realtime content when snapshot messages are empty", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }));
    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [],
      status: "processing",
    });

    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toHaveLength(1);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[0].content).toBe("hello");
  });

  it("preserves rich realtime step state when a completion snapshot is sparse", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_thinking", createSubSessionEvent({
      content: "answer",
      thinking: {
        steps: [{ id: "step-1", title: "Inspect", description: "Read the source", actions: [{ id: "open" }] }],
        summary: "working",
      },
      message: {
        pluginMeta: {
          source: "harness-plugin",
          stepEvents: [{ id: "step-1", state: "completed" }],
          interaction: { description: "Open the completed step", buttons: [{ id: "open" }] },
        },
      },
    }));

    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      status: "completed",
      messages: [{
        id: "msg-assistant-1",
        messageId: "msg-assistant-1",
        role: "assistant",
        content: "answer",
        status: "completed",
        pending: false,
        thinking: { summary: "done", steps: [] },
        pluginMeta: { interaction: null },
      }],
    });

    const message = store.selectSubSessionMessages("sub-session-1")?.messages?.[0];
    expect(message).toMatchObject({
      id: "msg-assistant-1",
      messageId: "msg-assistant-1",
      status: "completed",
      pending: false,
      thinking: {
        summary: "done",
        steps: [{ id: "step-1", description: "Read the source" }],
      },
      pluginMeta: {
        stepEvents: [{ id: "step-1", state: "completed" }],
        interaction: { description: "Open the completed step", buttons: [{ id: "open" }] },
      },
    });
    expect(message.rawEvents).toHaveLength(1);
  });


  it("lets authoritative snapshot message ids replace realtime temporary identities without duplicates", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "assistant-1", sequence: 1, content: "hello" }));
    store.upsertSubSessionEvent("subagent_tool_call", createSubSessionEvent({ eventId: "tool-1", sequence: 2, toolCallId: "call-1", toolCall: { name: "search" }, content: "" }));
    store.upsertSubSessionEvent("subagent_tool_result", createSubSessionEvent({ eventId: "tool-2", sequence: 3, toolCallId: "call-1", toolResult: { output: "ok" }, content: "" }));

    store.mergeSubSessionSnapshot({
      sessionId: "sub-session-1",
      messages: [
        { id: "msg-assistant-1", role: "assistant", content: "hello", turnScopeId: "turn-1", sequence: 1 },
        { id: "msg-tool-1", role: "tool", content: "ok", toolCallId: "call-1", sequence: 2 },
      ],
    });

    const messages = store.selectSubSessionMessages("sub-session-1")?.messages || [];
    expect(messages.map((message) => message.id)).toEqual(["msg-assistant-1", "msg-tool-1"]);
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => String(message.id).includes("turn-1:assistant"))).toBe(false);
    expect(messages.some((message) => String(message.id).includes("tool:call-1"))).toBe(false);
  });

  it("keeps multiple assistant turns and distinct tool calls separate during realtime projection", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "assistant-1", messageId: "msg-1", turnScopeId: "turn-1", sequence: 1, content: "first" }));
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "assistant-2", messageId: "msg-2", turnScopeId: "turn-2", sequence: 1, content: "second" }));
    store.upsertSubSessionEvent("subagent_tool_call", createSubSessionEvent({ eventId: "tool-1", messageId: "msg-2", turnScopeId: "turn-2", sequence: 2, toolCallId: "call-1", toolCall: { name: "one" }, content: "" }));
    store.upsertSubSessionEvent("subagent_tool_call", createSubSessionEvent({ eventId: "tool-2", messageId: "msg-2", turnScopeId: "turn-2", sequence: 3, toolCallId: "call-2", toolCall: { name: "two" }, content: "" }));

    const messages = store.selectSubSessionMessages("sub-session-1")?.messages || [];
    expect(messages.map((message) => message.content)).toEqual(["first", "second"]);
    expect(messages[1].toolCall).toEqual({ name: "two" });
    expect(messages[1].rawEvents).toHaveLength(3);
    expect(store.selectSubSessionMessages("sub-session-1")?.sequenceByScopeKey).toMatchObject({
      "message-event:msg-1": 1,
      "message-event:msg-2": 3,
    });
  });

  it("selects sub session messages by id and returns null for unknown sessions", () => {
    const store = useChatStore();
    expect(store.selectSubSessionMessages("unknown")).toBeNull();
    expect(store.selectSubSessionMessages("")).toBeNull();
  });

  it("resolves main and child Agent details through the same executionId selector", () => {
    const store = useChatStore();
    store.sessions.push({ id: "main-session", messages: [{ id: "main-message", content: "main" }] });
    store.mergeSubSessionSnapshot({
      sessionId: "child-session",
      messages: [{ id: "child-message", content: "child" }],
    });
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: "main-execution",
      tree: { executions: {
        "main-execution": {
          executionId: "main-execution", executionKind: "agent", rootExecutionId: "main-execution",
          sessionId: "main-session", turnScopeId: "main-turn", revision: 1, sequence: 1,
        },
        "child-execution": {
          executionId: "child-execution", executionKind: "agent", parentExecutionId: "main-execution",
          rootExecutionId: "main-execution", sessionId: "child-session", turnScopeId: "child-turn",
          revision: 1, sequence: 1,
        },
      } },
    });

    expect(store.selectExecutionDetail("main-execution")?.messages[0].content).toBe("main");
    expect(store.selectExecutionDetail("child-execution")?.messages[0].content).toBe("child");
    expect(store.selectExecutionDetail("main-execution")?.children.map((item) => item.executionId)).toEqual(["child-execution"]);
    expect(store.selectExecutionDetail("unknown")).toBeNull();
  });

  it("returns nested descendants once and remains safe for malformed relation cycles", () => {
    const store = useChatStore();
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: "workflow",
      tree: { executions: {
        workflow: {
          executionId: "workflow", executionKind: "workflow", rootExecutionId: "workflow",
          sessionId: "workflow-session", turnScopeId: "workflow-turn", revision: 1, sequence: 1,
        },
        child: {
          executionId: "child", executionKind: "agent", parentExecutionId: "workflow", rootExecutionId: "workflow",
          sessionId: "child-session", turnScopeId: "child-turn", revision: 1, sequence: 1,
        },
        grandchild: {
          executionId: "grandchild", executionKind: "agent", parentExecutionId: "child", rootExecutionId: "workflow",
          sessionId: "grandchild-session", turnScopeId: "grandchild-turn", revision: 1, sequence: 1,
        },
      } },
    });
    store.turnRuntimeRegistry.childExecutionIdsByParentId.grandchild = ["child"];

    expect(store.selectExecutionDescendants("workflow").map((item) => item.executionId)).toEqual(["child", "grandchild"]);
  });

  it("does not create an empty placeholder for lifecycle-only updates", () => {
    const store = useChatStore();
    const result = store.upsertSubSessionEvent("turn_lifecycle", createSubSessionEvent({
      eventId: "event-lifecycle",
      sequence: 1,
      status: "processing",
      content: "",
    }));

    expect(result.applied).toBe(true);
    expect(result.message).toBeNull();
    expect(store.selectSubSessionMessages("sub-session-1")?.status).toBe("processing");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toEqual([]);
  });

  it("merges lifecycle-only updates into an existing runtime message", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }));
    store.upsertSubSessionEvent("turn_lifecycle", createSubSessionEvent({ eventId: "event-lifecycle", sequence: 2, status: "completed", content: "" }));

    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toHaveLength(1);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[0]).toMatchObject({ content: "hello", status: "completed" });
  });
});
