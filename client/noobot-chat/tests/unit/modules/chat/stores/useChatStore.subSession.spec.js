/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";

function applyMessageEvent(store, eventName, data) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_message_event",
    data: { ...data, eventType: data?.eventType || eventName },
  }, { source: "test" });
}

function applySessionSnapshot(store, sessionDoc) {
  return store.applyWorkflowRuntimeEvent({
    event: "workflow_session_snapshot_loaded",
    data: { snapshotVersion: 1, ...sessionDoc },
  }, { source: "test_snapshot" });
}

function messageEvent(eventType, data = {}) {
  const messageId = data.messageId || "message-1";
  return {
    envelopeKind: "noobot.message_event",
    envelopeVersion: 2,
    timestamp: "2026-01-01T00:00:00.000Z",
    sequence: 1,
    eventType,
    messageId,
    sequenceDomain: "message-event",
    ...data,
    presentationMessageId: data.presentationMessageId || messageId,
    sequenceScopeId: data.sequenceScopeId || messageId,
  };
}

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
      messageId: "msg-assistant-1",
    };

    applyMessageEvent(store, "thinking_delta", messageEvent("thinking", {
      ...identity,
      eventId: "thinking-1",
      sequence: 1,
      role: "assistant",
      text: "```mermaid\ngraph TD; A-->B\n```",
    }));
    applyMessageEvent(store, "tool_result", messageEvent("tool_call_end", {
      ...identity,
      eventId: "tool-result-1",
      sequence: 2,
      role: "tool",
      toolCallId: "call-1",
      result: "ok",
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: "assistant",
      content: "",
    });
    expect(session.messages[0].activityTimeline).toEqual([
      expect.objectContaining({ event: "thinking", text: "```mermaid\ngraph TD; A-->B\n```" }),
    ]);
    expect(session.messages[0].toolTimeline).toEqual([
      expect.objectContaining({ key: "call:call-1", result: "ok", status: "completed" }),
    ]);
  });

  it("does not attach a tool event to an assistant from another turn", () => {
    const store = useChatStore();
    applyMessageEvent(store, "thinking_delta", messageEvent("thinking", {
      sessionId: "child-session",
      turnScopeId: "turn-1",
      eventId: "thinking-1",
      role: "assistant",
      text: "planning",
      messageId: "msg-assistant-1",
      sequence: 1,
    }));
    applyMessageEvent(store, "tool_result", messageEvent("tool_call_end", {
      sessionId: "child-session",
      turnScopeId: "turn-2",
      eventId: "tool-2",
      role: "tool",
      toolCallId: "call-2",
      content: "result",
      result: "result",
      messageId: "msg-assistant-2",
      sequence: 1,
    }));

    const session = store.selectSubSessionMessages("child-session");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].activityTimeline[0]).toMatchObject({ text: "planning" });
  });

  it("finalizes child runtime by turn instead of mutating message pending", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      turnScopeId: "turn-completed",
      dialogProcessId: "dialog-child",
      messageId: "assistant-completed",
    };
    applyMessageEvent(store, "thinking", messageEvent("thinking", {
      ...identity,
      eventId: "started",
      sequence: 1,
      status: "sending",
      pending: true,
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "working",
    }));
    store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        ...identity,
        workflowRunId: "workflow-1",
        nodeExecutionId: "node-1",
        parentSessionId: "parent-session",
        eventId: "completed",
        sequence: 2,
        revision: 2,
        sequenceDomain: "workflow-node-state",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
        timestamp: "2026-01-01T00:00:05.000Z",
      },
    }, { source: "test" });

    const session = store.selectSubSessionMessages("child-session");
    expect(session.turnStatuses).toEqual([expect.objectContaining({
      turnScopeId: "turn-completed",
      status: "completed",
    })]);
    expect(session.turnTimings).toEqual([expect.objectContaining({
      turnScopeId: "turn-completed",
      thinkingStartedAt: "2026-01-01T00:00:00.000Z",
      thinkingFinishedAt: "2026-01-01T00:00:05.000Z",
    })]);
    expect(session.messages[0].pending).toBe(true);
  });

  it("clears child message runtime only after authoritative Turn terminal materialization", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      turnScopeId: "turn-authoritative",
      dialogProcessId: "dialog-child",
      messageId: "assistant-authoritative",
    };
    applyMessageEvent(store, "thinking", messageEvent("thinking", {
      ...identity,
      eventId: "thinking-started",
      sequence: 1,
      status: "sending",
      pending: true,
      text: "working",
    }));

    const lifecycle = [
      ["turn.action_accepted", 1, "frontend_action_requesting"],
      ["turn.processing_started", 2, "frontend_processing"],
      ["turn.processing_completed", 3, "frontend_completion_requesting"],
      ["turn.completed", 4, "frontend_completion_requesting"],
    ];
    for (const [eventType, sequence] of lifecycle) {
      store.applyTurnRuntimeEvent({
        ...identity,
        type: "backend_turn_lifecycle",
        eventType,
        sequence,
        revision: sequence,
        timestamp: `2026-01-01T00:00:0${sequence}.000Z`,
      });
    }

    expect(store.selectSubSessionMessages("child-session").messages[0].pending).toBe(true);
    expect(store.selectSubSessionMessages("child-session").status).toBe("frontend_completion_requesting");

    const terminal = store.applyTurnTerminalResolution({
      protocolVersion: 1,
      eventType: "turn.terminal_resolved",
      commandId: "resolve-child-terminal",
      resolved: true,
      sessionId: identity.sessionId,
      turnScopeId: identity.turnScopeId,
      turn: {
        ...identity,
        state: "completed",
        revision: 4,
        sequence: 4,
        completionCommitId: "child-run:completed",
        summaryVersion: 1,
        finishedAt: "2026-01-01T00:00:05.000Z",
        terminalStatus: { command: "completed", description: "done" },
      },
      materialization: {
        terminalStatus: { command: "completed", description: "done" },
      },
    });
    expect(terminal.applied).toBe(true);
    store.projectAppliedTurnRuntime(terminal.turn);

    const completed = store.selectSubSessionMessages("child-session");
    expect(completed.status).toBe("completed");
    expect(completed.turnStatuses).toContainEqual(expect.objectContaining({
      turnScopeId: identity.turnScopeId,
      status: "completed",
    }));
    expect(completed.messages[0]).toMatchObject({
      pending: false,
      channelState: { state: "frontend_completed" },
    });
  });

  it("lets authoritative node timing replace an earlier message arrival time", () => {
    const store = useChatStore();
    const identity = {
      sessionId: "child-session",
      parentSessionId: "parent-session",
      turnScopeId: "workflow-node:node-timing",
      dialogProcessId: "dialog-child",
      workflowRunId: "workflow-1",
      nodeExecutionId: "node-timing",
      messageId: "assistant-timing",
    };
    applyMessageEvent(store, "thinking", messageEvent("thinking", {
      ...identity,
      eventId: "message-arrived",
      sequence: 1,
      timestamp: "2026-07-30T11:54:14.354Z",
      text: "working",
    }));

    store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        ...identity,
        eventId: "node-running",
        sequenceDomain: "workflow-node-state",
        sequence: 5,
        revision: 2,
        status: "running",
        startedAt: "2026-07-30T11:54:09.626Z",
        updatedAt: "2026-07-30T11:54:09.626Z",
      },
    }, { source: "live" });
    store.applyWorkflowRuntimeEvent({
      event: "workflow_node_state_committed",
      data: {
        ...identity,
        eventId: "node-succeeded",
        sequenceDomain: "workflow-node-state",
        sequence: 6,
        revision: 3,
        status: "succeeded",
        startedAt: "2026-07-30T11:54:09.626Z",
        completedAt: "2026-07-30T11:54:21.339Z",
        updatedAt: "2026-07-30T11:54:21.339Z",
      },
    }, { source: "live" });

    expect(store.selectSubSessionMessages("child-session").turnTimings).toEqual([
      expect.objectContaining({
        turnScopeId: "workflow-node:node-timing",
        thinkingStartedAt: "2026-07-30T11:54:09.626Z",
        thinkingFinishedAt: "2026-07-30T11:54:21.339Z",
      }),
    ]);
  });

  it("monotonically completes terminal snapshot facts across canonical turn scope aliases", () => {
    const store = useChatStore();
    const sessionId = "child-terminal-snapshot";
    store.applyWorkflowRuntimeEvent({
      event: "workflow_session_snapshot_loaded",
      data: {
        sessionId,
        snapshotVersion: 1,
        status: "succeeded",
        turnStatuses: [{ turnScopeId: "workflow-node_node-1", status: "succeeded" }],
        turnTimings: [{
          turnScopeId: "workflow-node_node-1",
          thinkingStartedAt: "2026-07-31T08:42:28.213Z",
        }],
      },
    }, { source: "test_snapshot" });
    store.applyWorkflowRuntimeEvent({
      event: "workflow_session_snapshot_loaded",
      data: {
        sessionId,
        snapshotVersion: 2,
        status: "completed",
        turnStatuses: [{ turnScopeId: "workflow-node:node-1", status: "completed" }],
        turnTimings: [{
          turnScopeId: "workflow-node:node-1",
          thinkingStartedAt: "2026-07-31T08:42:28.213Z",
          thinkingFinishedAt: "2026-07-31T08:43:59.859Z",
        }],
      },
    }, { source: "test_snapshot" });

    const session = store.selectSubSessionMessages(sessionId);
    expect(session.turnStatuses).toEqual([expect.objectContaining({
      turnScopeId: "workflow-node:node-1",
      status: "completed",
    })]);
    expect(session.turnTimings).toEqual([expect.objectContaining({
      turnScopeId: "workflow-node:node-1",
      thinkingStartedAt: "2026-07-31T08:42:28.213Z",
      thinkingFinishedAt: "2026-07-31T08:43:59.859Z",
    })]);
  });

  it("removes replaced workflow owners from both workflow registries", () => {
    const store = useChatStore();
    const addWorkflow = (workflowRunId, ownerTurnScopeId, nodeExecutionId, sessionId) => {
      store.applyWorkflowRuntimeEvent({
        event: "workflow_planning_message_prepared",
        data: {
          workflowRunId,
          sessionId: "parent-session",
          turnScopeId: ownerTurnScopeId,
          presentationMessageId: `assistant:${ownerTurnScopeId}`,
          nodeSessions: [{
            workflowRunId,
            nodeExecutionId,
            sessionId,
            parentSessionId: "parent-session",
            turnScopeId: `workflow-node:${nodeExecutionId}`,
            eventId: `${nodeExecutionId}:ready`,
            sequenceDomain: "workflow-node-state",
            sequence: 1,
            revision: 1,
            status: "ready",
          }],
        },
      }, { source: "live" });
    };
    addWorkflow("workflow:old-turn", "old-turn", "old-node", "old-child");
    addWorkflow("workflow:new-turn", "new-turn", "new-node", "new-child");

    const result = store.removeWorkflowOwnersForReplacedTurns({
      parentSessionId: "parent-session",
      replacedTurnScopeIds: ["old-turn"],
    });

    expect(result.removedWorkflowRunIds).toEqual(["workflow:old-turn"]);
    expect(store.workflowNodeStateRegistry.workflows["workflow:old-turn"]).toBeUndefined();
    expect(store.selectSubSessionMessages("old-child")).toBeNull();
    expect(store.workflowNodeStateRegistry.workflows["workflow:new-turn"]).toBeTruthy();
    expect(store.selectSubSessionMessages("new-child")).toBeTruthy();
  });
});
