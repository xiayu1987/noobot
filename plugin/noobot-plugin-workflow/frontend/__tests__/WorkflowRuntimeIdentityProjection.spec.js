/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createRuntimeNodeSessions } from "../runtime/workflowRuntimeSessions.js";
import { createStepStatusResolver } from "../runtime/workflowRuntimeStatus.js";

describe("workflow runtime identity projection", () => {
  it("merges a committed node fact into a sparse final node by dialog identity", () => {
    const workflowPayload = ref({
      workflowRunId: "client-turn:main",
      runMeta: { sessionId: "root-session" },
    });
    const runtimeNodeSessions = createRuntimeNodeSessions({
      workflowPayload,
      nodeSessions: ref([
        {
          nodeId: "write-file",
          sessionId: "child-session",
          dialogProcessId: "wf_node_write_file_1",
          stepId: "persisted-step",
        },
      ]),
      executionMeta: ref({ nodeAgentRuns: [] }),
      workflowNodeStateRegistry: {
        workflows: {
          "client-turn:main": {
            nodes: {
              "node-execution-1": {
                workflowRunId: "client-turn:main",
                nodeExecutionId: "node-execution-1",
                nodeId: "write-file",
                sessionId: "child-session",
                dialogProcessId: "wf_node_write_file_1",
                turnScopeId: "workflow-node:node-execution-1",
                activeChildExecutionId: "agent:node-execution-1",
                status: "succeeded",
                revision: 3,
                sequence: 5,
              },
            },
          },
        },
      },
    });

    expect(runtimeNodeSessions.value).toHaveLength(1);
    expect(runtimeNodeSessions.value[0]).toMatchObject({
      nodeExecutionId: "node-execution-1",
      turnScopeId: "workflow-node:node-execution-1",
      activeChildExecutionId: "agent:node-execution-1",
      status: "succeeded",
      sessionId: "child-session",
    });
  });

  it("preserves canonical status at the runtime input boundary", () => {
    const runtimeNodeSessions = createRuntimeNodeSessions({
      workflowPayload: ref({ workflowRunId: "client-turn:main" }),
      nodeSessions: ref([
        {
          nodeExecutionId: "node-execution-running",
          dialogProcessId: "running-dialog",
          status: "running",
        },
      ]),
      executionMeta: ref({ nodeAgentRuns: [] }),
      workflowNodeStateRegistry: { workflows: {} },
    });

    expect(runtimeNodeSessions.value[0]).toMatchObject({
      nodeExecutionId: "node-execution-running",
      status: "running",
    });
  });

  it("resolves the authoritative status for nodes with a stable execution identity", () => {
    const resolveStepStatus = createStepStatusResolver({
      nodeRunByDialogProcessId: ref(new Map()),
    });

    expect(resolveStepStatus({ nodeExecutionId: "node-execution-1", status: "running" })).toBe(
      "running",
    );
    expect(resolveStepStatus({ nodeExecutionId: "node-execution-1", status: "succeeded" })).toBe(
      "success",
    );
  });
});
