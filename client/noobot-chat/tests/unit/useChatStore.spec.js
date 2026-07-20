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
  return {
    sessionId: "sub-session-1",
    parentSessionId: "main-session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    workflowRunId: "workflow-1",
    nodeExecutionId: "node-1",
    sequence: 1,
    revision: 1,
    eventId: "event-1",
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

  it("merges delta, thinking, tool and lifecycle updates in sequence order", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "he" }));
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
    expect(session?.messages).toHaveLength(6);
    expect(session?.messages.map((message) => message.content)).toEqual(["he", "llo", "", "", "", ""]);
    expect(session?.messages[2]).toMatchObject({ thinking: { steps: ["plan"] } });
    expect(session?.messages[3]).toMatchObject({ toolCall: { name: "search" } });
    expect(session?.messages[4]).toMatchObject({ toolResult: { output: "ok" } });
    expect(session?.messages[5]).toMatchObject({ status: "completed" });
    expect(session?.sequence).toBe(6);
    expect(session?.revision).toBe(1);
  });

  it("keeps events ordered when realtime updates arrive out of sequence", () => {
    const store = useChatStore();
    store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-2", sequence: 2, content: "second" }));
    const earlier = store.upsertSubSessionEvent("subagent_delta", createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "first" }));

    expect(earlier.applied).toBe(true);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages.map((message) => message.content)).toEqual(["first", "second"]);
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
        { id: "msg-1", role: "assistant", content: "hello", sequence: 1 },
        { id: "msg-2", role: "assistant", content: "world", sequence: 2 },
      ],
    });

    expect(snapshot.applied).toBe(true);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toHaveLength(2);
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[0].content).toBe("hello");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages[1].content).toBe("world");
    expect(store.selectSubSessionMessages("sub-session-1")?.eventsById?.["event-1"]).toBeTruthy();
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
    // A corrupted read index must not make the UI selector loop forever.
    store.turnRuntimeRegistry.childExecutionIdsByParentId.grandchild = ["child"];

    expect(store.selectExecutionDescendants("workflow").map((item) => item.executionId)).toEqual(["child", "grandchild"]);
  });
});
