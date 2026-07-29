/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import {
  selectTurnMessageRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function applyNodeEvent(store, data) {
  return store.applyWorkflowRuntimeEvent({ event: "workflow_node_state_committed", data }, { source: "test" });
}

function applyPlanningEvent(store, data) {
  return store.applyWorkflowRuntimeEvent({ event: "workflow_planning_message_prepared", data }, { source: "test" });
}

function nodeEvent(overrides = {}) {
  return {
    workflowRunId: "workflow-run-a",
    nodeExecutionId: "node-exec-a",
    commandId: "cmd-a",
    sessionId: "child-session-a",
    parentSessionId: "parent-session",
    dialogProcessId: "wf_node_node-exec-a",
    turnScopeId: "workflow-node:node-exec-a",
    status: "running",
    eventId: "evt-1",
    revision: 1,
    sequence: 1,
    occurredAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function storedNode(store, workflowRunId = "workflow-run-a", nodeExecutionId = "node-exec-a") {
  return store.workflowNodeStateRegistry.workflows?.[workflowRunId]?.nodes?.[nodeExecutionId] || null;
}

describe("useChatStore workflow node state registry", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("rejects events missing workflow or node identity", () => {
    const store = useChatStore();

    expect(applyNodeEvent(store, nodeEvent({ workflowRunId: "" }))).toMatchObject({
      applied: false,
      reason: "missing_identity",
    });
    expect(applyNodeEvent(store, nodeEvent({ nodeExecutionId: "" }))).toMatchObject({
      applied: false,
      reason: "missing_identity",
    });
    expect(store.workflowNodeStateRegistry).toBeNull();
  });

  it("applies newer revisions and rejects revision rollback", () => {
    const store = useChatStore();

    expect(applyNodeEvent(store, nodeEvent({ revision: 2, sequence: 2, eventId: "evt-2" })).applied).toBe(true);
    const stale = applyNodeEvent(store, nodeEvent({ revision: 1, sequence: 9, eventId: "evt-stale", status: "failed" }));

    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe("stale");
    expect(storedNode(store).eventId).toBe("evt-2");
    expect(storedNode(store).status).toBe("running");
  });

  it("projects child node lifecycle into the canonical Turn Runtime Registry", () => {
    const store = useChatStore();

    applyNodeEvent(store, nodeEvent({ status: "running", revision: 2, sequence: 2, eventId: "evt-running" }));
    const running = selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "child-session-a",
      turnScopeId: "workflow-node:node-exec-a",
    });
    expect(running.running).toBe(true);
    expect(running.state).toBe("frontend_processing");
    expect(running.dialogProcessId).toBe("");

    const timing = store.applyTurnTimingSnapshot({
      sessionId: "child-session-a",
      turnTimings: [{
        turnScopeId: "workflow-node:node-exec-a",
        dialogProcessId: "real-child-dialog",
        thinkingStartedAt: "2026-07-19T00:00:00.000Z",
      }],
    });
    expect(timing.applied).toBe(true);
    expect(selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "child-session-a",
      turnScopeId: "workflow-node:node-exec-a",
    }).dialogProcessId).toBe("real-child-dialog");

    applyNodeEvent(store, nodeEvent({ status: "succeeded", revision: 3, sequence: 3, eventId: "evt-completed" }));
    const completed = selectTurnMessageRuntime(store.turnRuntimeRegistry, {
      sessionId: "child-session-a",
      turnScopeId: "workflow-node:node-exec-a",
    });
    expect(completed.running).toBe(false);
    expect(completed.terminal).toBe("completed");
  });

  it("applies newer sequence within the same revision and rejects sequence rollback", () => {
    const store = useChatStore();

    applyNodeEvent(store, nodeEvent({ revision: 2, sequence: 3, eventId: "evt-3" }));
    const stale = applyNodeEvent(store, nodeEvent({ revision: 2, sequence: 2, eventId: "evt-2", status: "failed" }));

    expect(stale.applied).toBe(false);
    expect(storedNode(store).eventId).toBe("evt-3");
  });

  it("keeps duplicate eventId idempotent and rejects same sequence conflicts", () => {
    const store = useChatStore();

    const first = applyNodeEvent(store, nodeEvent({ eventId: "evt-same", revision: 4, sequence: 4, status: "running" }));
    const duplicate = applyNodeEvent(store, nodeEvent({ eventId: "evt-same", revision: 4, sequence: 4, status: "running" }));
    const conflict = applyNodeEvent(store, nodeEvent({ eventId: "evt-other", revision: 4, sequence: 4, status: "succeeded" }));

    expect(first.applied).toBe(true);
    expect(duplicate.applied).toBe(true);
    expect(conflict.applied).toBe(false);
    expect(conflict.reason).toBe("stale");
    expect(storedNode(store).eventId).toBe("evt-same");
    expect(storedNode(store).status).toBe("running");
  });

  it("isolates different workflow runs and node executions", () => {
    const store = useChatStore();

    applyNodeEvent(store, nodeEvent({ workflowRunId: "workflow-run-a", nodeExecutionId: "node-a", eventId: "evt-a", sessionId: "child-a" }));
    applyNodeEvent(store, nodeEvent({ workflowRunId: "workflow-run-a", nodeExecutionId: "node-b", eventId: "evt-b", sessionId: "child-b" }));
    applyNodeEvent(store, nodeEvent({ workflowRunId: "workflow-run-b", nodeExecutionId: "node-a", eventId: "evt-c", sessionId: "child-c" }));

    expect(storedNode(store, "workflow-run-a", "node-a").sessionId).toBe("child-a");
    expect(storedNode(store, "workflow-run-a", "node-b").sessionId).toBe("child-b");
    expect(storedNode(store, "workflow-run-b", "node-a").sessionId).toBe("child-c");
  });

  it("deduplicates realtime and reconnect delivery of the same committed fact", () => {
    const store = useChatStore();
    const committed = nodeEvent({ eventId: "evt-replayed", revision: 7, sequence: 7, status: "succeeded", sessionId: "child-final" });

    expect(applyNodeEvent(store, committed).applied).toBe(true);
    expect(applyNodeEvent(store, { ...committed }).applied).toBe(true);

    expect(Object.keys(store.workflowNodeStateRegistry.workflows["workflow-run-a"].nodes)).toEqual(["node-exec-a"]);
    expect(storedNode(store).status).toBe("succeeded");
    expect(storedNode(store).sessionId).toBe("child-final");
  });

  it("resetChatStore clears workflow node state registry", () => {
    const store = useChatStore();
    applyNodeEvent(store, nodeEvent());

    expect(storedNode(store)).toBeTruthy();
    store.resetChatStore();

    expect(store.workflowNodeStateRegistry).toBeNull();
  });

  it("applies workflow planning nodes with initial monotonic revisions", () => {
    const store = useChatStore();

    const result = applyPlanningEvent(store, {
      workflowRunId: "workflow-run-a",
      sessionId: "parent-session",
      dialogProcessId: "planning-dialog",
      turnScopeId: "planning-turn",
      createdAt: "2026-07-19T00:00:00.000Z",
      nodeSessions: [
        nodeEvent({ nodeExecutionId: "node-a", status: "ready", stepStatus: "ready", eventId: "", revision: undefined, sequence: undefined }),
        nodeEvent({ nodeExecutionId: "node-b", status: "pending", stepStatus: "pending", eventId: "", revision: undefined, sequence: undefined }),
      ],
    });

    expect(result.applied).toBe(true);
    expect(store.workflowNodeStateRegistry.workflows["workflow-run-a"]).toMatchObject({
      workflowRunId: "workflow-run-a",
      sessionId: "parent-session",
      dialogProcessId: "planning-dialog",
      turnScopeId: "planning-turn",
      plannedAt: "2026-07-19T00:00:00.000Z",
    });
    expect(storedNode(store, "workflow-run-a", "node-a").status).toBe("ready");
    expect(storedNode(store, "workflow-run-a", "node-a").sessionId).toBe("child-session-a");
    expect(storedNode(store, "workflow-run-a", "node-a").parentSessionId).toBe("parent-session");
    expect(storedNode(store, "workflow-run-a", "node-a").revision).toBe(1);
    expect(storedNode(store, "workflow-run-a", "node-a").sequence).toBe(1);
    expect(storedNode(store, "workflow-run-a", "node-a").eventId).toBe("workflow-plan:node-a");
    expect(storedNode(store, "workflow-run-a", "node-b").status).toBe("pending");
    expect(storedNode(store, "workflow-run-a", "node-b").sequence).toBe(2);
  });

  it("lets committed node state override planning state but rejects planning rollback", () => {
    const store = useChatStore();

    applyPlanningEvent(store, {
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({ nodeExecutionId: "node-exec-a", status: "ready", sessionId: "" })],
    });
    expect(applyNodeEvent(store, nodeEvent({ revision: 2, sequence: 3, status: "running", sessionId: "child-live" })).applied).toBe(true);
    const stalePlan = applyPlanningEvent(store, {
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({ nodeExecutionId: "node-exec-a", status: "ready", sessionId: "" })],
    });

    expect(stalePlan.applied).toBe(false);
    expect(storedNode(store).status).toBe("running");
    expect(storedNode(store)).not.toHaveProperty("stepStatus");
    expect(storedNode(store).sessionId).toBe("child-live");
    expect(storedNode(store).revision).toBe(2);
  });

  it("stores one authoritative lifecycle status through ready, running, and succeeded", () => {
    const store = useChatStore();

    applyPlanningEvent(store, {
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({
        status: "ready",
        stepStatus: "ready",
        revision: 1,
        sequence: 1,
        eventId: "plan-ready",
      })],
    });
    expect(storedNode(store)).toMatchObject({ status: "ready" });
    expect(storedNode(store)).not.toHaveProperty("stepStatus");

    expect(applyNodeEvent(store, nodeEvent({
      status: "running",
      stepStatus: undefined,
      revision: 2,
      sequence: 2,
      eventId: "node-running",
    })).applied).toBe(true);
    expect(storedNode(store)).toMatchObject({ status: "running" });
    expect(storedNode(store)).not.toHaveProperty("stepStatus");

    expect(applyNodeEvent(store, nodeEvent({
      status: "succeeded",
      stepStatus: undefined,
      revision: 3,
      sequence: 3,
      eventId: "node-succeeded",
    })).applied).toBe(true);
    expect(storedNode(store)).toMatchObject({ status: "succeeded" });
    expect(storedNode(store)).not.toHaveProperty("stepStatus");
  });

  it("does not let a delayed planning alias overwrite the committed terminal state", () => {
    const store = useChatStore();

    applyPlanningEvent(store, {
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({ status: "ready", stepStatus: "ready", revision: 1, sequence: 1 })],
    });
    applyNodeEvent(store, nodeEvent({
      status: "succeeded",
      stepStatus: undefined,
      revision: 3,
      sequence: 3,
      eventId: "node-succeeded",
    }));
    const stale = applyNodeEvent(store, nodeEvent({
      status: "running",
      stepStatus: "ready",
      revision: 2,
      sequence: 2,
      eventId: "delayed-running",
    }));

    expect(stale).toMatchObject({ applied: false, reason: "terminal_state_immutable" });
    expect(storedNode(store)).toMatchObject({ status: "succeeded" });
    expect(storedNode(store)).not.toHaveProperty("stepStatus");
  });

  it.each(["succeeded", "failed", "cancelled", "stopped"])(
    "does not reopen the %s terminal state even with a newer running event",
    (terminalStatus) => {
      const store = useChatStore();
      applyNodeEvent(store, nodeEvent({
        status: terminalStatus,
        revision: 3,
        sequence: 3,
        eventId: `node-${terminalStatus}`,
      }));

      const reopened = applyNodeEvent(store, nodeEvent({
        status: "running",
        revision: 4,
        sequence: 4,
        eventId: `late-running-after-${terminalStatus}`,
      }));

      expect(reopened).toMatchObject({ applied: false, reason: "terminal_state_immutable" });
      expect(storedNode(store)).toMatchObject({ status: terminalStatus, eventId: `node-${terminalStatus}` });
    },
  );

  it("rejects planning events without workflow identity or node sessions", () => {
    const store = useChatStore();

    expect(applyPlanningEvent(store, { workflowRunId: "", nodeSessions: [nodeEvent()] })).toMatchObject({
      applied: false,
      reason: "missing_planning_nodes",
    });
    expect(applyPlanningEvent(store, { workflowRunId: "workflow-run-a", nodeSessions: [] })).toMatchObject({
      applied: false,
      reason: "missing_planning_nodes",
    });
    expect(store.workflowNodeStateRegistry).toBeNull();
  });
});
