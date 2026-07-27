/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { projectWorkflowMessageIdentity } from "../composables/useWorkflowMeta.js";
import { createRuntimeNodeSessions } from "../runtime/workflowRuntimeSessions.js";

describe("workflow runtime identity projection", () => {
  it("restores a missing persisted workflowRunId from the outer Turn envelope", () => {
    const payload = projectWorkflowMessageIdentity({
      execution: { completed: true },
      nodeSessions: [{ sessionId: "child-session" }],
    }, {
      sessionId: "root-session",
      dialogProcessId: "root-dialog",
      turnScopeId: "client-turn:main",
    });

    expect(payload).toMatchObject({
      workflowRunId: "client-turn:main",
      execution: {
        workflowRunId: "client-turn:main",
        instanceId: "client-turn:main",
      },
      planningDialog: { sessionId: "root-session", dialogProcessId: "root-dialog" },
    });
  });

  it("merges a committed node fact into a sparse final node by dialog identity", () => {
    const workflowPayload = ref({
      workflowRunId: "client-turn:main",
      planningDialog: { sessionId: "root-session" },
    });
    const runtimeNodeSessions = createRuntimeNodeSessions({
      workflowPayload,
      nodeSessions: ref([{
        nodeId: "write-file",
        sessionId: "child-session",
        dialogProcessId: "wf_node_write_file_1",
        stepId: "persisted-step",
      }]),
      executionMeta: ref({ nodeAgentRuns: [] }),
      workflowNodeStateRegistry: ref({
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
      }),
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
});
