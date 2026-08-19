/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

export function createDeps(overrides = {}) {
  const calls = {
    runSessionPayloads: [],
    persistencePayloads: [],
    mergePayload: null,
    prepareRunConfigPayload: null,
    loadedWorkspacePath: "",
    emitted: [],
    lifecyclePayloads: [],
  };
  const deps = {
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
          output: "agent answer",
          traces: [{ type: "trace" }],
          turnTasks: [{ taskId: "t1" }],
          turnMessages: [{ role: "assistant", content: "agent answer" }],
          dialogProcessId: payload.dialogProcessId || "sub-dialog",
          lifecycle: { executionState: "completed" },
          session: { sessionId: payload.sessionId, aggregateVersion: 3 },
        };
      },
    },
    session: {
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
        return { applied: true, envelope: turn, turn };
      },
      createScopedPersistenceContext(payload = {}) {
        calls.persistencePayloads.push(payload);
        return Object.freeze({
          locationResolver: { marker: payload.relativeDir },
          metadataContributor: payload.metadataContributor,
        });
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

export function createParentContext(extra = {}) {
  return {
    userId: "u1",
    sessionId: "parent1",
    dialogProcessId: "parent-dialog",
    runConfig: { base: true },
    ...extra,
  };
}

export function createParentExecutionScope(runtimePatch = {}) {
  return createTestAgentExecutionScope({
    userId: "u1",
    systemRuntime: {
      sessionId: "parent1",
      dialogProcessId: "parent-dialog",
      turnScopeId: "parent-turn",
    },
    ...runtimePatch,
  });
}

export function createCompleteStrategy(overrides = {}) {
  const turnScopeId = String(overrides.turnScopeId || "turn-1").trim();
  return {
    userId: "u1",
    sessionId: "sub1",
    parentSessionId: "parent1",
    parentDialogProcessId: "parent-dialog",
    dialogProcessId: "sub-dialog",
    turnScopeId,
    executionId: `agent:${turnScopeId}`,
    relativeDir: "runtime/workflow/session/root/node-a",
    allowedRoot: "runtime/workflow/session",
    ...overrides,
  };
}
