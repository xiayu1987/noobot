/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../src/shared/stores/useChatStore.js";

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

    expect(store.upsertWorkflowNodeStateEvent(nodeEvent({ workflowRunId: "" }))).toEqual({
      applied: false,
      reason: "missing_identity",
    });
    expect(store.upsertWorkflowNodeStateEvent(nodeEvent({ nodeExecutionId: "" }))).toEqual({
      applied: false,
      reason: "missing_identity",
    });
    expect(store.workflowNodeStateRegistry).toBeNull();
  });

  it("applies newer revisions and rejects revision rollback", () => {
    const store = useChatStore();

    expect(store.upsertWorkflowNodeStateEvent(nodeEvent({ revision: 2, sequence: 2, eventId: "evt-2" })).applied).toBe(true);
    const stale = store.upsertWorkflowNodeStateEvent(nodeEvent({ revision: 1, sequence: 9, eventId: "evt-stale", status: "failed" }));

    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe("stale");
    expect(storedNode(store).eventId).toBe("evt-2");
    expect(storedNode(store).status).toBe("running");
  });

  it("applies newer sequence within the same revision and rejects sequence rollback", () => {
    const store = useChatStore();

    store.upsertWorkflowNodeStateEvent(nodeEvent({ revision: 2, sequence: 3, eventId: "evt-3" }));
    const stale = store.upsertWorkflowNodeStateEvent(nodeEvent({ revision: 2, sequence: 2, eventId: "evt-2", status: "failed" }));

    expect(stale.applied).toBe(false);
    expect(storedNode(store).eventId).toBe("evt-3");
  });

  it("keeps duplicate eventId idempotent and rejects same sequence conflicts", () => {
    const store = useChatStore();

    const first = store.upsertWorkflowNodeStateEvent(nodeEvent({ eventId: "evt-same", revision: 4, sequence: 4, status: "running" }));
    const duplicate = store.upsertWorkflowNodeStateEvent(nodeEvent({ eventId: "evt-same", revision: 4, sequence: 4, status: "running" }));
    const conflict = store.upsertWorkflowNodeStateEvent(nodeEvent({ eventId: "evt-other", revision: 4, sequence: 4, status: "succeeded" }));

    expect(first.applied).toBe(true);
    expect(duplicate.applied).toBe(true);
    expect(conflict.applied).toBe(false);
    expect(conflict.reason).toBe("stale");
    expect(storedNode(store).eventId).toBe("evt-same");
    expect(storedNode(store).status).toBe("running");
  });

  it("isolates different workflow runs and node executions", () => {
    const store = useChatStore();

    store.upsertWorkflowNodeStateEvent(nodeEvent({ workflowRunId: "workflow-run-a", nodeExecutionId: "node-a", eventId: "evt-a", sessionId: "child-a" }));
    store.upsertWorkflowNodeStateEvent(nodeEvent({ workflowRunId: "workflow-run-a", nodeExecutionId: "node-b", eventId: "evt-b", sessionId: "child-b" }));
    store.upsertWorkflowNodeStateEvent(nodeEvent({ workflowRunId: "workflow-run-b", nodeExecutionId: "node-a", eventId: "evt-c", sessionId: "child-c" }));

    expect(storedNode(store, "workflow-run-a", "node-a").sessionId).toBe("child-a");
    expect(storedNode(store, "workflow-run-a", "node-b").sessionId).toBe("child-b");
    expect(storedNode(store, "workflow-run-b", "node-a").sessionId).toBe("child-c");
  });

  it("deduplicates realtime and reconnect delivery of the same committed fact", () => {
    const store = useChatStore();
    const committed = nodeEvent({ eventId: "evt-replayed", revision: 7, sequence: 7, status: "succeeded", sessionId: "child-final" });

    expect(store.upsertWorkflowNodeStateEvent(committed).applied).toBe(true);
    expect(store.upsertWorkflowNodeStateEvent({ ...committed }).applied).toBe(true);

    expect(Object.keys(store.workflowNodeStateRegistry.workflows["workflow-run-a"].nodes)).toEqual(["node-exec-a"]);
    expect(storedNode(store).status).toBe("succeeded");
    expect(storedNode(store).sessionId).toBe("child-final");
  });

  it("resetChatStore clears workflow node state registry", () => {
    const store = useChatStore();
    store.upsertWorkflowNodeStateEvent(nodeEvent());

    expect(storedNode(store)).toBeTruthy();
    store.resetChatStore();

    expect(store.workflowNodeStateRegistry).toBeNull();
  });

  it("applies workflow planning nodes with initial monotonic revisions", () => {
    const store = useChatStore();

    const result = store.upsertWorkflowPlanningEvent({
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

    store.upsertWorkflowPlanningEvent({
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({ nodeExecutionId: "node-exec-a", status: "ready", sessionId: "" })],
    });
    expect(store.upsertWorkflowNodeStateEvent(nodeEvent({ revision: 2, sequence: 3, status: "running", sessionId: "child-live" })).applied).toBe(true);
    const stalePlan = store.upsertWorkflowPlanningEvent({
      workflowRunId: "workflow-run-a",
      nodeSessions: [nodeEvent({ nodeExecutionId: "node-exec-a", status: "ready", sessionId: "" })],
    });

    expect(stalePlan.applied).toBe(false);
    expect(storedNode(store).status).toBe("running");
    expect(storedNode(store).sessionId).toBe("child-live");
    expect(storedNode(store).revision).toBe(2);
  });

  it("rejects planning events without workflow identity or node sessions", () => {
    const store = useChatStore();

    expect(store.upsertWorkflowPlanningEvent({ workflowRunId: "", nodeSessions: [nodeEvent()] })).toEqual({
      applied: false,
      reason: "missing_planning_nodes",
    });
    expect(store.upsertWorkflowPlanningEvent({ workflowRunId: "workflow-run-a", nodeSessions: [] })).toEqual({
      applied: false,
      reason: "missing_planning_nodes",
    });
    expect(store.workflowNodeStateRegistry).toBeNull();
  });
});
