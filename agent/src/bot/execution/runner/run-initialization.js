/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { runBotRuntimeHook, withBotHookRuntimeMeta } from "../../hook/index.js";
import {
  createAgentLifecycleMachine,
  resolveInitialLifecycleState,
} from "../../../runtime/lifecycle/state-machine.js";
import { resolveRunTurnScopeId } from "../turn-command.js";
import { readSelectedModelValue } from "./debug-utils.js";
import { buildSessionRuntimePluginResolvedEvent } from "./plugin-runtime.js";

function applyCanonicalRunMessageIdentity(runConfig = {}) {
  const turnScopeId = String(runConfig?.turnScopeId || "").trim();
  const presentationMessageId = String(
    runConfig?.presentationMessageId || `msg_${turnScopeId}`,
  ).trim();
  const messageId = String(runConfig?.messageId || `msg_event_${presentationMessageId}`).trim();
  runConfig.presentationMessageId = presentationMessageId;
  runConfig.messageId = messageId;
  return { turnScopeId, presentationMessageId, messageId };
}

export async function initializeSessionRun({
  normalizeRunMessage,
  validateRunInput,
  assertReusedUserTurnIdentity,
  ensureParentAsyncResultContainer,
  initializeRunSessionRuntime,
  resolveScenarioRunConfig,
  prepareRunConfig,
  now,
  userId,
  sessionId,
  message,
  eventListener,
  caller,
  parentSessionId,
  parentDialogProcessId,
  requestedDialogProcessId,
  abortSignal,
  runConfig,
  requestedTurnScopeId,
  parentAsyncResultContainer,
  persistenceContext,
}) {
  const normalizedMessage = normalizeRunMessage(message);
  validateRunInput({ userId, sessionId, caller, parentSessionId });
  if (
    runConfig?.reuseExistingUserTurn === true &&
    !String(requestedDialogProcessId || "").trim()
  ) {
    const error = new Error("reused Turn requires its precommitted dialogProcessId");
    error.statusCode = 400;
    error.errorCode = "MISSING_REUSED_TURN_DIALOG_PROCESS_ID";
    throw error;
  }
  if (runConfig?.reuseExistingUserTurn === true) {
    if (typeof assertReusedUserTurnIdentity !== "function") {
      throw new Error("assertReusedUserTurnIdentity is required before reused Turn initialization");
    }
    await assertReusedUserTurnIdentity({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId: String(requestedTurnScopeId || runConfig?.turnScopeId || "").trim(),
      dialogProcessId: String(requestedDialogProcessId || "").trim(),
      ...(persistenceContext ? { persistenceContext } : {}),
    });
  }
  const normalizedRequestTurnScopeId = resolveRunTurnScopeId({
    caller,
    turnScopeId: requestedTurnScopeId || runConfig?.turnScopeId,
  });
  const resolvedParentAsyncResultContainer = ensureParentAsyncResultContainer({
    parentAsyncResultContainer,
    caller,
    parentSessionId,
    parentDialogProcessId,
  });
  const initialized = await initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId,
    caller,
    eventListener,
    dialogProcessId: requestedDialogProcessId,
    turnScopeId: normalizedRequestTurnScopeId,
    thinkingStartedAt: String(runConfig?.thinkingStartedAt || "").trim(),
    persistenceContext,
  });
  const {
    usedSessionId,
    dialogProcessId,
    sessionLoadState,
    userConfig,
    currentSessionModelAlias,
    executionStartIndex,
    runtimeEventListener,
  } = initialized;
  const requestRunConfig = {
    ...(runConfig && typeof runConfig === "object" && !Array.isArray(runConfig) ? runConfig : {}),
    ...(normalizedRequestTurnScopeId ? { turnScopeId: normalizedRequestTurnScopeId } : {}),
    sessionId: usedSessionId,
    dialogProcessId,
  };
  const scenarioResolvedRunConfig = resolveScenarioRunConfig(requestRunConfig, userConfig);
  const resolvedRunConfig =
    typeof prepareRunConfig === "function"
      ? prepareRunConfig({ userId, runConfig: scenarioResolvedRunConfig, userConfig })
      : scenarioResolvedRunConfig;
  const { turnScopeId, presentationMessageId, messageId } =
    applyCanonicalRunMessageIdentity(resolvedRunConfig);
  const resumeFromStoppedSnapshot = resolvedRunConfig?.resumeFromStoppedSnapshot === true;
  const lifecycle = createAgentLifecycleMachine({
    eventListener: runtimeEventListener,
    now,
    basePayload: {
      sessionId: usedSessionId,
      dialogProcessId,
      turnScopeId,
      resumeFromStoppedSnapshot,
      executionId: String(resolvedRunConfig?.executionId || "").trim(),
      executionKind: String(resolvedRunConfig?.executionKind || "agent").trim(),
      parentExecutionId: String(resolvedRunConfig?.parentExecutionId || "").trim(),
      rootExecutionId: String(
        resolvedRunConfig?.rootExecutionId || resolvedRunConfig?.executionId || "",
      ).trim(),
    },
  });
  lifecycle.transition(resolveInitialLifecycleState(resolvedRunConfig));
  if (
    !String(resolvedRunConfig?.runtimeModel || "").trim() &&
    !readSelectedModelValue(resolvedRunConfig?.selectedModel) &&
    String(currentSessionModelAlias || "").trim()
  ) {
    resolvedRunConfig.runtimeModel = String(currentSessionModelAlias || "").trim();
  }
  const botHookRuntime = {
    eventListener: runtimeEventListener,
    abortSignal,
    botHookManager:
      resolvedRunConfig?.botHookManager && typeof resolvedRunConfig.botHookManager === "object"
        ? resolvedRunConfig.botHookManager
        : null,
  };
  const botHookBase = withBotHookRuntimeMeta(
    { userId, sessionId: usedSessionId, parentSessionId, dialogProcessId, caller },
    { runConfig: resolvedRunConfig },
  );
  for (const record of resolvedRunConfig.pluginLifecycleEvents || []) {
    emitEvent(runtimeEventListener, record.event, {
      ...record,
      sessionId: usedSessionId,
      dialogProcessId,
      turnScopeId,
    });
  }
  delete resolvedRunConfig.pluginLifecycleEvents;
  emitEvent(
    runtimeEventListener,
    "plugin_runtime_resolved",
    buildSessionRuntimePluginResolvedEvent(resolvedRunConfig),
  );
  await runBotRuntimeHook({
    runtime: botHookRuntime,
    point: HOOK_POINT.BOT.BEFORE_SESSION_RUN,
    context: {
      ...botHookBase,
      message: normalizedMessage,
      isContinue: resumeFromStoppedSnapshot,
      sessionLoadState,
      resumeFromStoppedSnapshot,
    },
    eventListener: runtimeEventListener,
  });
  return {
    normalizedMessage,
    resolvedParentAsyncResultContainer,
    usedSessionId,
    dialogProcessId,
    sessionLoadState,
    userConfig,
    executionStartIndex,
    runtimeEventListener,
    requestRunConfig,
    scenarioResolvedRunConfig,
    resolvedRunConfig,
    turnScopeId,
    presentationMessageId,
    messageId,
    resumeFromStoppedSnapshot,
    contextMode: sessionLoadState === "loaded" ? "existing_session" : "new_session",
    lifecycle,
    botHookRuntime,
    botHookBase,
  };
}
