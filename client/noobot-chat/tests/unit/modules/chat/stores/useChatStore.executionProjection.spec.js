/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { applyExecutionTree } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { canonicalWorkflowRuntimeEvent } from "../helpers/workflowRuntimeEventFixture.js";
import {
  applyMessageEvent,
  applySessionSnapshot,
  assistantMessages,
  commitPresentation,
  createSubSessionEvent,
  resetChatStore,
} from "./useChatStoreTestFixture.js";

describe("useChatStore execution projection", () => {
  beforeEach(resetChatStore);

  it("keeps sub session projection isolated from main session storage", () => {
    const store = useChatStore();
    commitPresentation(store);
    const result = applyMessageEvent(store, createSubSessionEvent({ content: "hello" }));

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

  it("selects sub session messages by id and returns null for unknown sessions", () => {
    const store = useChatStore();
    expect(store.selectSubSessionMessages("unknown")).toBeNull();
    expect(store.selectSubSessionMessages("")).toBeNull();
  });

  it("resolves main and child Agent details through the same executionId selector", () => {
    const store = useChatStore();
    store.sessions.push({
      sessionId: "main-session",
      messages: [{ id: "main-message", content: "main" }],
    });
    applySessionSnapshot(store, {
      sessionId: "child-session",
      messages: [{ id: "child-message", messageId: "child-message", content: "child" }],
    });
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: "main-execution",
      tree: {
        executions: {
          "main-execution": {
            executionId: "main-execution",
            executionKind: "agent",
            rootExecutionId: "main-execution",
            sessionId: "main-session",
            turnScopeId: "main-turn",
            revision: 1,
            sequence: 1,
          },
          "child-execution": {
            executionId: "child-execution",
            executionKind: "agent",
            parentExecutionId: "main-execution",
            rootExecutionId: "main-execution",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            revision: 1,
            sequence: 1,
          },
        },
      },
    });

    expect(store.selectExecutionDetail("main-execution")?.messages[0].content).toBe("main");
    expect(store.selectExecutionDetail("child-execution")?.messages[0].content).toBe("child");
    expect(
      store.selectExecutionDetail("main-execution")?.children.map((item) => item.executionId),
    ).toEqual(["child-execution"]);
    expect(store.selectExecutionDetail("unknown")).toBeNull();
  });

  it("returns nested descendants once and remains safe for malformed relation cycles", () => {
    const store = useChatStore();
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: "workflow",
      tree: {
        executions: {
          workflow: {
            executionId: "workflow",
            executionKind: "workflow",
            rootExecutionId: "workflow",
            sessionId: "workflow-session",
            turnScopeId: "workflow-turn",
            revision: 1,
            sequence: 1,
          },
          child: {
            executionId: "child",
            executionKind: "agent",
            parentExecutionId: "workflow",
            rootExecutionId: "workflow",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            revision: 1,
            sequence: 1,
          },
          grandchild: {
            executionId: "grandchild",
            executionKind: "agent",
            parentExecutionId: "child",
            rootExecutionId: "workflow",
            sessionId: "grandchild-session",
            turnScopeId: "grandchild-turn",
            revision: 1,
            sequence: 1,
          },
        },
      },
    });
    store.turnRuntimeRegistry.childExecutionIdsByParentId.grandchild = ["child"];

    expect(store.selectExecutionDescendants("workflow").map((item) => item.executionId)).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("does not create an empty placeholder for lifecycle-only updates", () => {
    const store = useChatStore();
    const result = store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        eventId: "event-lifecycle",
        sequence: 1,
        revision: 1,
        sequenceDomain: "workflow-node-state",
        status: "processing",
        sessionId: "sub-session-1",
        parentSessionId: "main-session-1",
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      }),
      { source: "test" },
    );

    expect(result.applied).toBe(true);
    expect(result).not.toHaveProperty("message");
    expect(store.selectSubSessionMessages("sub-session-1")?.status).toBe("");
    expect(store.selectSubSessionMessages("sub-session-1")?.messages).toEqual([]);
  });

  it("merges lifecycle-only updates into an existing runtime message", () => {
    const store = useChatStore();
    commitPresentation(store);
    applyMessageEvent(
      store,
      createSubSessionEvent({ eventId: "event-1", sequence: 1, content: "hello" }),
    );
    store.applyWorkflowRuntimeEvent(
      canonicalWorkflowRuntimeEvent(WORKFLOW_RUNTIME_EVENT.NODE_STATE, {
        eventId: "event-lifecycle",
        sequence: 2,
        revision: 2,
        sequenceDomain: "workflow-node-state",
        status: "completed",
        sessionId: "sub-session-1",
        parentSessionId: "main-session-1",
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      }),
      { source: "test" },
    );

    expect(assistantMessages(store)).toHaveLength(1);
    expect(assistantMessages(store)[0]).toMatchObject({ content: "hello" });
    expect(store.selectSubSessionMessages("sub-session-1")?.workflowNodeState).toMatchObject({
      status: "completed",
    });
  });
});
