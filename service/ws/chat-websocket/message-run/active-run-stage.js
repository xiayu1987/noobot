/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createExecutionAbortReason, EXECUTION_ABORT_TYPE } from "@noobot/session-protocol";
import { attachRunTransport, registerActiveRun } from "../run-registry.js";
import { recordServiceWebSocketLifecycle } from "../runtime-events.js";
import {
  isPluginDebugEnabled,
  resolveEffectiveRunTimeoutMs,
  resolveEffectiveStreamingEnabled,
  summarizePluginConfig,
} from "../run-config.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const text = (value) => String(value || "").trim();

async function recordPluginDebug(context, command, run) {
  if (!isPluginDebugEnabled()) return;
  await writeRoutedRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    event: "service.websocket.pluginDebug.runConfig",
    userId: text(run.userId),
    sessionId: text(run.sessionId),
    dialogProcessId: text(run.dialogProcessId),
    turnScopeId: text(run.normalizedRunConfig.turnScopeId || context.state.currentTurnScopeId),
    data: {
      requestedSelectedPlugins: command.preferences.selectedPlugins,
      normalizedSelectedPlugins: run.normalizedRunConfig.selectedPlugins,
      normalizedPlugins: summarizePluginConfig(run.normalizedRunConfig.plugins),
      normalizedThinkingStartedAt: text(run.normalizedRunConfig.thinkingStartedAt),
    },
  });
}

function scheduleTimeout(context, run, timeoutMs) {
  context.state.currentRunTimeoutTimer = setTimeout(() => {
    context.state.currentRunTimedOut = true;
    void recordServiceWebSocketLifecycle({
      sessionLogConfig: context.sessionLogConfig,
      event: "service.websocket.run.timeout",
      userId: context.state.currentRunMeta?.userId || run.userId,
      sessionId: context.state.currentRunMeta?.sessionId || run.sessionId,
      dialogProcessId: context.state.currentRunMeta?.dialogProcessId || "",
      turnScopeId: context.state.currentRunMeta?.turnScopeId || context.state.currentTurnScopeId,
      data: { timeoutMs },
    });
    context.state.currentAbortController?.abort(
      createExecutionAbortReason({
        type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT,
        reason: `run timeout after ${timeoutMs}ms`,
        timeoutMs,
      }),
    );
  }, timeoutMs);
}

function createRunMeta(context, command, run) {
  return {
    commandId: text(command.commandId),
    commandType: command.commandType,
    userId: text(run.userId),
    runOwnerId: context.canonicalRunOwnerId,
    sessionId: text(run.sessionId),
    parentSessionId: text(run.parentSessionId),
    parentDialogProcessId: text(run.parentDialogProcessId),
    dialogProcessId: text(run.dialogProcessId),
    turnScopeId: text(run.normalizedRunConfig.turnScopeId || context.state.currentTurnScopeId),
  };
}

function applyPendingStop(context, runHandle) {
  const controller = context.state.currentAbortController;
  if (!context.state.stopRequested || !controller || controller.signal?.aborted) return;
  runHandle.stopRequested = true;
  runHandle.stopPayload = context.state.currentStopPayload;
  controller.abort(
    createExecutionAbortReason({
      type: EXECUTION_ABORT_TYPE.USER_STOP,
      reason: "user stop action",
      stopPayload: context.state.currentStopPayload,
    }),
  );
}

export async function activateRun(context, command, run, accepted, onRunBound) {
  context.state.isRunning = true;
  context.state.currentAbortController = new AbortController();
  context.state.currentRunTimedOut = false;
  context.state.currentAbortSignal = context.state.currentAbortController.signal;
  await recordPluginDebug(context, command, run);
  const runTimeoutMs = await resolveEffectiveRunTimeoutMs({
    bot: accepted.activeBot,
    userId: run.userId,
    runConfig: run.normalizedRunConfig,
  });
  scheduleTimeout(context, run, runTimeoutMs);
  const runMeta = createRunMeta(context, command, run);
  context.state.currentRunMeta = runMeta;
  const runHandle = registerActiveRun({
    userId: runMeta.runOwnerId,
    sessionId: runMeta.sessionId,
    dialogProcessId: runMeta.dialogProcessId,
    turnScopeId: runMeta.turnScopeId,
    abortController: context.state.currentAbortController,
    stopRequested: false,
    stopPayload: null,
  });
  context.state.currentRunHandle = runHandle;
  context.state.currentRunTransportBinding = attachRunTransport(runHandle, context.sendEvent, {
    onDiagnostic: context.recordRunTransportDiagnostic(runMeta),
  });
  onRunBound?.(runHandle);
  applyPendingStop(context, runHandle);
  const textStreamingEnabled = await resolveEffectiveStreamingEnabled({
    bot: accepted.activeBot,
    userId: run.userId,
    runConfig: run.normalizedRunConfig,
  });
  return { runTimeoutMs, runMeta, runHandle, textStreamingEnabled };
}
