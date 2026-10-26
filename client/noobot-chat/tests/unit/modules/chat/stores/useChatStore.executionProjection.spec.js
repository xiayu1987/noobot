/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { deriveAgentExecutionId } from "@noobot/session-protocol/execution-lifecycle";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { applyExecutionTree } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { canonicalWorkflowNodeStateEvent } from "../helpers/workflowRuntimeEventFixture.js";
import {
  applyMessageEvent,
  applySessionSnapshot,
  assistantMessages,
  commitPresentation,
  createSubSessionEvent,
  resetChatStore,
} from "./useChatStoreTestFixture.js";

const MAIN_EXECUTION_ID = deriveAgentExecutionId({ turnScopeId: "main-turn" });
const CHILD_EXECUTION_ID = deriveAgentExecutionId({ turnScopeId: "child-turn" });
const CHILD_AGENT_ID = CHILD_EXECUTION_ID;
const GRANDCHILD_AGENT_ID = deriveAgentExecutionId({ turnScopeId: "grandchild-turn" });

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
    expect(store.selectSubSessionMessages("sub-session-1")).not.toHaveProperty("id");
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
      messages: [{ role: "assistant", presentationMessageId: "main-message", content: "main" }],
    });
    applySessionSnapshot(store, {
      nodeSessionId: "child-session",
      messages: [
        {
          role: "assistant",
          messageUid: "sm_child-message",
          presentationMessageId: "child-message",
          content: "child",
        },
      ],
    });
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: MAIN_EXECUTION_ID,
      tree: {
        executions: {
          [MAIN_EXECUTION_ID]: {
            executionId: MAIN_EXECUTION_ID,
            executionKind: "agent",
            rootExecutionId: MAIN_EXECUTION_ID,
            sessionId: "main-session",
            turnScopeId: "main-turn",
            revision: 1,
            sequence: 1,
          },
          [CHILD_EXECUTION_ID]: {
            executionId: CHILD_EXECUTION_ID,
            executionKind: "agent",
            parentExecutionId: MAIN_EXECUTION_ID,
            rootExecutionId: MAIN_EXECUTION_ID,
            sessionId: "child-session",
            turnScopeId: "child-turn",
            revision: 1,
            sequence: 1,
          },
        },
      },
    });

    expect(store.selectExecutionDetail(MAIN_EXECUTION_ID)?.session.messages[0].content).toBe(
      "main",
    );
    expect(store.selectExecutionDetail(CHILD_EXECUTION_ID)?.session.messages[0].content).toBe(
      "child",
    );
    expect(
      store.selectExecutionDetail(MAIN_EXECUTION_ID)?.children.map((item) => item.executionId),
    ).toEqual([CHILD_EXECUTION_ID]);
    expect(store.selectExecutionDetail(MAIN_EXECUTION_ID)).not.toHaveProperty("messages");
    expect(store.selectExecutionDetail("unknown")).toBeNull();
  });

  function registerMainExecution(store) {
    applyExecutionTree(store.turnRuntimeRegistry, {
      rootExecutionId: MAIN_EXECUTION_ID,
      tree: {
        executions: {
          [MAIN_EXECUTION_ID]: {
            executionId: MAIN_EXECUTION_ID,
            executionKind: "agent",
            rootExecutionId: MAIN_EXECUTION_ID,
            sessionId: "main-session",
            turnScopeId: "main-turn",
            revision: 1,
            sequence: 1,
          },
        },
      },
    });
  }

  it("returns no execution detail while the execution session document is not loaded", () => {
    const store = useChatStore();
    registerMainExecution(store);
    expect(store.selectExecutionDetail(MAIN_EXECUTION_ID)).toBeNull();
  });

  it("rejects an execution session document without a messages array", () => {
    const store = useChatStore();
    store.sessions.push({ sessionId: "main-session" });
    registerMainExecution(store);
    expect(() => store.selectExecutionDetail(MAIN_EXECUTION_ID)).toThrow(TypeError);
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
          [CHILD_AGENT_ID]: {
            executionId: CHILD_AGENT_ID,
            executionKind: "agent",
            parentExecutionId: "workflow",
            rootExecutionId: "workflow",
            sessionId: "child-session",
            turnScopeId: "child-turn",
            revision: 1,
            sequence: 1,
          },
          [GRANDCHILD_AGENT_ID]: {
            executionId: GRANDCHILD_AGENT_ID,
            executionKind: "agent",
            parentExecutionId: CHILD_AGENT_ID,
            rootExecutionId: "workflow",
            sessionId: "grandchild-session",
            turnScopeId: "grandchild-turn",
            revision: 1,
            sequence: 1,
          },
        },
      },
    });
    store.turnRuntimeRegistry.childExecutionIdsByParentId[GRANDCHILD_AGENT_ID] = [CHILD_AGENT_ID];

    expect(store.selectExecutionDescendants("workflow").map((item) => item.executionId)).toEqual([
      CHILD_AGENT_ID,
      GRANDCHILD_AGENT_ID,
    ]);
  });

  it("does not create an empty placeholder for lifecycle-only updates", () => {
    const store = useChatStore();
    const result = store.applyWorkflowRuntimeEvent(
      canonicalWorkflowNodeStateEvent({
        eventId: "event-lifecycle",
        sequence: 1,
        revision: 1,
        status: "running",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
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
      canonicalWorkflowNodeStateEvent({
        eventId: "event-lifecycle",
        sequence: 2,
        revision: 2,
        status: "succeeded",
        nodeSessionId: "sub-session-1",
        authoritySessionId: "main-session-1",
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
      status: "succeeded",
    });
  });
});
