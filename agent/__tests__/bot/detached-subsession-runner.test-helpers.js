/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { TOOL_NAME } from "../../src/tools/constants/index.js";

export const DETACHED_REQUEST_METADATA = Object.freeze({ scope: TOOL_NAME.CALL_MCP_TASK });
const DETACHED_TEST_NOW = () => "2026-01-01T00:00:00.000Z";

export function createDeps(overrides = {}) {
  const calls = {
    runSessionPayloads: [],
    metadataWrites: [],
    mergePayload: null,
    prepareRunConfigPayload: null,
    loadedWorkspacePath: "",
    emitted: [],
    lifecyclePayloads: [],
    executionLogs: [],
  };
  const deps = {
    now: DETACHED_TEST_NOW,
    workspaceService: {
      getWorkspacePath(userId = "") {
        return `/tmp/workspace/${userId}`;
      },
    },
    configService: {
      async loadUserConfig(workspacePath = "") {
        calls.loadedWorkspacePath = workspacePath;
        return { userConfigLoaded: true };
      },
    },
    sessionRunner: {
      async runSession(payload = {}) {
        calls.runSessionPayloads.push(payload);
        return {
          answer: "agent answer",
          traces: [{ type: "trace" }],
          messages: [{ messageUid: "sm_child", role: "assistant", content: "agent answer" }],
          dialogProcessId: payload.dialogProcessId,
        };
      },
    },
    session: {
      async appendExecutionLog(payload = {}) {
        calls.executionLogs.push(payload);
        return { appended: true };
      },
      async applyTurnLifecycleEvent(payload = {}) {
        calls.lifecyclePayloads.push(payload);
        const sequence = calls.lifecyclePayloads.length;
        const stateByEventType = {
          "turn.action_accepted": "action_accepted",
          "turn.processing_started": "processing",
          "turn.processing_completed": "processing_completed",
          "turn.completed": "completed",
          "turn.stop_accepted": "stop_accepted",
          "turn.stop_processing_completed": "stop_processing_completed",
          "turn.stop_completed": "stop_completed",
          "turn.failed": "processing_failed",
        };
        const turn = {
          ...payload,
          state: stateByEventType[payload.eventType] || "",
          sequence,
          revision: sequence,
        };
        const userMessage =
          payload.eventType === "turn.action_accepted" && payload.userMessage
            ? { ...payload.userMessage, messageUid: `sm_${payload.turnScopeId}` }
            : null;
        return { applied: true, envelope: turn, turn, userMessage, aggregateVersion: sequence };
      },
      async writeSessionMetadata(payload = {}) {
        calls.metadataWrites.push(payload);
      },
    },
    mergeRunConfigPluginPolicy(payload = {}) {
      calls.mergePayload = payload;
      return {
        ...payload.baseRunConfig,
        ...payload.runConfigPatch,
        disabledPlugins: payload.disabledPlugins,
        hookManager: { shouldBeDeleted: true },
        hooks: { shouldBeDeleted: true },
        botHookManager: { shouldBeDeleted: true },
        botHooks: { shouldBeDeleted: true },
      };
    },
    prepareRunConfig(payload = {}) {
      calls.prepareRunConfigPayload = payload;
      return {
        ...payload.runConfig,
        hookManager: null,
        botHookManager: null,
        selectedPlugins: ["harness", "workflow"],
        plugins: {
          harness: { enabled: true, mode: "on" },
          workflow: { enabled: true, mode: "on" },
        },
      };
    },
  };
  return { calls, deps: { ...deps, ...overrides } };
}

export function createParentExecutionScope(runtimePatch = {}) {
  return createTestAgentExecutionScope(
    createTestRuntimeContext({
      identity: {
        sessionId: "parent1",
        dialogProcessId: "parent-dialog",
        turnScopeId: "parent-turn",
      },
      systemRuntime: {},
      runConfig: { hookManager: null, base: true },
      ...runtimePatch,
    }),
  );
}

export function createCompleteStrategy(overrides = {}) {
  const turnScopeId = overrides.turnScopeId ?? "turn-1";
  const executionId = overrides.executionId ?? `agent:${turnScopeId}`;
  return {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    parentDialogProcessId: "parent-dialog",
    dialogProcessId: "sub-dialog",
    turnScopeId,
    executionId,
    rootExecutionId: executionId,
    relativeDir: "runtime/plugin-data/workflow/session/root/node-a",
    allowedRoot: "runtime/plugin-data/workflow/session",
    ...overrides,
  };
}
