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
import { buildSessionRuntimePluginResolvedEvent } from "./plugin-runtime.js";
import { isPlainObject, text } from "@noobot/shared/value";

const REQUIRED_RUN_IDENTITY_FIELDS = Object.freeze([
  "presentationMessageId",
  "messageId",
  "executionId",
  "executionKind",
  "rootExecutionId",
  "commandId",
]);

function requireAcceptedRunIdentity(runConfig = {}) {
  const missing = REQUIRED_RUN_IDENTITY_FIELDS.filter((field) => !text(runConfig?.[field]));
  if (missing.length > 0) {
    const error = new Error(`session run requires accepted identity: ${missing.join(",")}`);
    error.statusCode = 400;
    error.code = "MISSING_ACCEPTED_RUN_IDENTITY";
    throw error;
  }
  return {
    turnScopeId: text(runConfig.turnScopeId),
    presentationMessageId: text(runConfig.presentationMessageId),
    messageId: text(runConfig.messageId),
  };
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
  const normalizedRequestTurnScopeId = text(requestedTurnScopeId);
  if (!normalizedRequestTurnScopeId) {
    const error = new Error("session run requires turnScopeId");
    error.statusCode = 400;
    error.code = "MISSING_TURN_SCOPE_ID";
    throw error;
  }
  if (runConfig?.reuseExistingUserTurn === true && !text(requestedDialogProcessId)) {
    const error = new Error("reused Turn requires its precommitted dialogProcessId");
    error.statusCode = 400;
    error.code = "MISSING_REUSED_TURN_DIALOG_PROCESS_ID";
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
      turnScopeId: normalizedRequestTurnScopeId,
      dialogProcessId: text(requestedDialogProcessId),
      ...(persistenceContext ? { persistenceContext } : {}),
    });
  }
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
    thinkingStartedAt: text(runConfig?.thinkingStartedAt),
    persistenceContext,
  });
  const {
    usedSessionId,
    dialogProcessId,
    sessionLoadState,
    userConfig,
    currentSessionModelAlias,
    sessionDir,
    runtimeEventListener,
  } = initialized;
  const requestRunConfig = {
    ...(isPlainObject(runConfig) ? runConfig : {}),
    turnScopeId: normalizedRequestTurnScopeId,
    sessionId: usedSessionId,
    dialogProcessId,
  };
  const scenarioResolvedRunConfig = resolveScenarioRunConfig(requestRunConfig, userConfig);
  const resolvedRunConfig =
    typeof prepareRunConfig === "function"
      ? prepareRunConfig({ userId, runConfig: scenarioResolvedRunConfig, userConfig })
      : scenarioResolvedRunConfig;
  const { turnScopeId, presentationMessageId, messageId } =
    requireAcceptedRunIdentity(resolvedRunConfig);
  const resumeFromStoppedSnapshot = resolvedRunConfig?.resumeFromStoppedSnapshot === true;
  const lifecycle = createAgentLifecycleMachine({
    eventListener: runtimeEventListener,
    now,
    basePayload: {
      sessionId: usedSessionId,
      dialogProcessId,
      turnScopeId,
      resumeFromStoppedSnapshot,
      executionId: text(resolvedRunConfig.executionId),
      executionKind: text(resolvedRunConfig.executionKind),
      parentExecutionId: text(resolvedRunConfig.parentExecutionId),
      rootExecutionId: text(resolvedRunConfig.rootExecutionId),
      origin: isPlainObject(resolvedRunConfig.origin) ? { ...resolvedRunConfig.origin } : {},
      stage: text(resolvedRunConfig.stage),
    },
  });
  lifecycle.transition(resolveInitialLifecycleState(resolvedRunConfig));
  if (
    !text(resolvedRunConfig?.runtimeModel) &&
    !text(resolvedRunConfig?.selectedModel) &&
    text(currentSessionModelAlias)
  ) {
    resolvedRunConfig.runtimeModel = text(currentSessionModelAlias);
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
    sessionDir,
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
