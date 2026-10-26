/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createExecutionAbortReason, EXECUTION_ABORT_TYPE } from "@noobot/session-protocol";
import { attachRunTransport, registerActiveRun } from "../run-registry.js";
import { recordServiceWebSocketLifecycle } from "../runtime-events.js";
import {
  resolveEffectiveRunTimeoutMs,
  resolveEffectiveStreamingEnabled,
  summarizePluginConfig,
} from "../run-config.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { text } from "@noobot/shared/value";

async function recordPluginDebug(command, run) {
  await writeRuntimeEvent({
    scope: "session",
    source: "service",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    debugType: "plugin-run-config",
    event: "service.websocket.pluginDebug.runConfig",
    userId: text(run.userId),
    sessionId: text(run.sessionId),
    dialogProcessId: text(run.dialogProcessId),
    turnScopeId: text(run.turnScopeId),
    data: {
      requestedSelectedPlugins: command.preferences.selectedPlugins,
      normalizedSelectedPlugins: run.normalizedRunConfig.selectedPlugins,
      normalizedPlugins: summarizePluginConfig(run.normalizedRunConfig.plugins),
    },
  });
}

function scheduleTimeout(context, runMeta, timeoutMs) {
  context.state.currentRunTimeoutTimer = setTimeout(() => {
    context.state.currentRunTimedOut = true;
    void recordServiceWebSocketLifecycle({
      event: "service.websocket.run.timeout",
      userId: runMeta.userId,
      sessionId: runMeta.sessionId,
      dialogProcessId: runMeta.dialogProcessId,
      turnScopeId: runMeta.turnScopeId,
      data: { timeoutMs },
    });
    context.state.currentAbortController.abort(
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
    turnScopeId: text(run.turnScopeId),
    presentationMessageId: text(run.normalizedRunConfig.presentationMessageId),
  };
}

export function reserveRun(context, run, onRunBound) {
  context.state.isRunning = true;
  context.state.currentAbortController = new AbortController();
  context.state.currentRunTimedOut = false;
  context.state.currentAbortSignal = context.state.currentAbortController.signal;
  const runHandle = registerActiveRun({
    userId: context.canonicalRunOwnerId,
    sessionId: text(run.sessionId),
    turnScopeId: text(run.turnScopeId),
    abortController: context.state.currentAbortController,
  });
  context.state.currentRunHandle = runHandle;
  onRunBound?.(runHandle);
  return runHandle;
}

export async function activateRun(context, command, run, accepted) {
  const runMeta = createRunMeta(context, command, run);
  context.state.currentRunMeta = runMeta;
  const runHandle = registerActiveRun(
    Object.assign(context.state.currentRunHandle, runMeta, { userId: runMeta.runOwnerId }),
  );
  context.state.currentRunTransportBinding = attachRunTransport(runHandle, context.sendEvent, {
    onDiagnostic: context.recordRunTransportDiagnostic(runMeta),
  });
  await recordPluginDebug(command, run);
  const runTimeoutMs = await resolveEffectiveRunTimeoutMs({
    runConfig: run.normalizedRunConfig,
  });
  if (!context.state.currentAbortSignal.aborted) scheduleTimeout(context, runMeta, runTimeoutMs);
  const textStreamingEnabled = await resolveEffectiveStreamingEnabled({
    bot: accepted.activeBot,
    userId: run.userId,
    runConfig: run.normalizedRunConfig,
  });
  return { runTimeoutMs, runMeta, runHandle, textStreamingEnabled };
}
