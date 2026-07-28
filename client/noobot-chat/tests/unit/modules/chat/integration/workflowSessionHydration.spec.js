/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  hydrateWorkflowRegistryFromSessionDetail,
  workflowPlanningEventFromMessage,
} from "../../../../../../../plugin/noobot-plugin-workflow/frontend/runtime/sessionHydration.js";
import {
  confirmTurnRuntimeDeletion,
  createTurnRuntimeRegistryState,
  isTurnRuntimeDeleted,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function workflowMessage() {
  return {
    role: "assistant",
    type: "workflow",
    content: "WORKFLOW_DSL/1\nNODE id=a type=action name=\"A\"",
    turnScopeId: "turn-a",
    dialogProcessId: "dialog-a",
    pluginMeta: { payload: {
      workflowRunId: "workflow-a",
      planningDialog: { sessionId: "session-a", dialogProcessId: "dialog-a" },
      nodeSessions: [{ nodeExecutionId: "node-a", status: "running" }],
    } },
  };
}

describe("workflow session hydration", () => {
  it("rebuilds planning state after a refresh cleared the live registry", () => {
    const upsert = vi.fn();
    expect(hydrateWorkflowRegistryFromSessionDetail({
      detail: { sessionId: "session-a" },
      mainSessionDoc: { messages: [workflowMessage()] },
      upsertWorkflowPlanningEvent: upsert,
    })).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: "workflow-a",
      turnScopeId: "turn-a",
      nodeSessions: [expect.objectContaining({ nodeExecutionId: "node-a" })],
    }));
  });

  it("rebuilds a running workflow from persisted runtime events before the final message exists", () => {
    const upsertPlanning = vi.fn(() => ({ applied: true }));
    const upsertNodeState = vi.fn(() => ({ applied: true }));
    const planning = {
      workflowRunId: "workflow-running",
      sessionId: "session-a",
      dialogProcessId: "dialog-a",
      turnScopeId: "turn-a",
      semanticText: "WORKFLOW_DSL/1\nNODE id=a type=action name=\"A\"",
      nodeSessions: [{ nodeExecutionId: "node-a", stepStatus: "ready" }],
    };
    const running = {
      workflowRunId: "workflow-running",
      nodeExecutionId: "node-a",
      status: "running",
      revision: 2,
      sequence: 2,
    };

    expect(hydrateWorkflowRegistryFromSessionDetail({
      detail: {
        sessionId: "session-a",
        workflowRuntimeEvents: [
          { event: "workflow_planning_message_prepared", data: planning },
          { event: "workflow_node_state_committed", data: running },
        ],
      },
      mainSessionDoc: { messages: [{ role: "user", type: "message", content: "run" }] },
      upsertWorkflowPlanningEvent: upsertPlanning,
      upsertWorkflowNodeStateEvent: upsertNodeState,
    })).toBe(1);
    expect(upsertPlanning).toHaveBeenCalledWith(planning);
    expect(upsertNodeState).toHaveBeenCalledWith(running);
  });

  it("supports persisted execution node runs when refresh happens during execution", () => {
    const message = workflowMessage();
    message.pluginMeta.payload.nodeSessions = undefined;
    message.pluginMeta.payload.execution = {
      instanceId: "workflow-a",
      nodeAgentRuns: [{ nodeExecutionId: "node-a", status: "running" }],
    };
    expect(workflowPlanningEventFromMessage(message, "session-a")?.nodeSessions).toHaveLength(1);
  });

  it("rejects planning and node replay for a deleted root Turn", () => {
    const applyRuntimeEvent = vi.fn(() => ({ applied: true }));
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-a", { sessionId: "session-a" });

    expect(hydrateWorkflowRegistryFromSessionDetail({
      detail: {
        sessionId: "session-a",
        workflowRuntimeEvents: [
          {
            event: "workflow_node_state_committed",
            data: { workflowRunId: "workflow-a", nodeExecutionId: "node-a", status: "running" },
          },
          {
            event: "workflow_planning_message_prepared",
            data: {
              workflowRunId: "workflow-a",
              sessionId: "session-a",
              turnScopeId: "turn-a",
              nodeSessions: [{ nodeExecutionId: "node-a" }],
            },
          },
        ],
      },
      mainSessionDoc: { messages: [workflowMessage()] },
      applyWorkflowRuntimeEvent: applyRuntimeEvent,
      turnRuntimeRegistry,
      isTurnRuntimeDeleted,
    })).toBe(0);
    expect(applyRuntimeEvent).not.toHaveBeenCalled();
  });

  it("continues hydrating an unrelated Turn", () => {
    const applyRuntimeEvent = vi.fn(() => ({ applied: true }));
    const turnRuntimeRegistry = createTurnRuntimeRegistryState();
    confirmTurnRuntimeDeletion(turnRuntimeRegistry, "turn-deleted", { sessionId: "session-a" });

    expect(hydrateWorkflowRegistryFromSessionDetail({
      detail: {
        sessionId: "session-a",
        workflowRuntimeEvents: [{
          event: "workflow_planning_message_prepared",
          data: {
            workflowRunId: "workflow-a",
            sessionId: "session-a",
            turnScopeId: "turn-a",
            nodeSessions: [{ nodeExecutionId: "node-a" }],
          },
        }],
      },
      applyWorkflowRuntimeEvent: applyRuntimeEvent,
      turnRuntimeRegistry,
      isTurnRuntimeDeleted,
    })).toBe(1);
    expect(applyRuntimeEvent).toHaveBeenCalledOnce();
  });
});
