/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { createRuntimeNodeSessions } from "../runtime/workflowRuntimeSessions.js";
import {
  resolveActionRuntimeStatus,
  resolveWorkflowNodeStatus,
  resolveWorkflowNodeStatusLabelKey,
} from "../runtime/workflowRuntimeStatus.js";

describe("workflow runtime identity projection", () => {
  it("merges a committed node fact into the planned node by nodeExecutionId", () => {
    const workflowPayload = ref({
      workflowRunId: "client-turn:main",
      runMeta: { sessionId: "root-session" },
    });
    const runtimeNodeSessions = createRuntimeNodeSessions({
      workflowPayload,
      nodeSessions: ref([
        {
          nodeExecutionId: "node-execution-1",
          nodeId: "write-file",
          nodeSessionId: "child-session",
          dialogProcessId: "wf_node_write_file_1",
          status: "pending",
        },
      ]),
      workflowNodeStateRegistry: {
        workflows: {
          "client-turn:main": {
            nodes: {
              "node-execution-1": {
                workflowRunId: "client-turn:main",
                nodeExecutionId: "node-execution-1",
                nodeId: "write-file",
                nodeSessionId: "child-session",
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
      nodeSessionId: "child-session",
    });
    expect(runtimeNodeSessions.value[0]).not.toHaveProperty("sessionId");
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
      workflowNodeStateRegistry: { workflows: {} },
    });

    expect(runtimeNodeSessions.value[0]).toMatchObject({
      nodeExecutionId: "node-execution-running",
      status: "running",
    });
  });

  it("resolves node status only from the protocol vocabulary", () => {
    for (const status of [
      "pending",
      "ready",
      "running",
      "succeeded",
      "failed",
      "stopped",
      "skipped",
    ])
      expect(resolveWorkflowNodeStatus({ status })).toBe(status);
    for (const status of ["success", "error", "done", "completed"])
      expect(resolveWorkflowNodeStatus({ status })).toBe("pending");
    expect(resolveWorkflowNodeStatus({ _status: "running" })).toBe("pending");
    expect(resolveWorkflowNodeStatusLabelKey({ status: "stopped" })).toBe("workflow.statusStopped");
  });

  it("aggregates action status from protocol step statuses", () => {
    const boxes = (...statuses) => [{ steps: statuses.map((status) => ({ status })) }];
    expect(resolveActionRuntimeStatus([])).toBe("pending");
    expect(resolveActionRuntimeStatus(boxes("succeeded", "running"))).toBe("running");
    expect(resolveActionRuntimeStatus(boxes("succeeded", "failed"))).toBe("failed");
    expect(resolveActionRuntimeStatus(boxes("succeeded", "stopped"))).toBe("stopped");
    expect(resolveActionRuntimeStatus(boxes("skipped", "skipped"))).toBe("skipped");
    expect(resolveActionRuntimeStatus(boxes("succeeded", "skipped"))).toBe("succeeded");
    expect(resolveActionRuntimeStatus(boxes("succeeded", "ready"))).toBe("ready");
  });
});
