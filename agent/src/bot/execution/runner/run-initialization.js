/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import {
  HOOK_POINT,
  assertNoHookRuntimeIdentityFields,
  createHookRuntimeIdentity,
  withHookRuntimeIdentity,
} from "@noobot/hook-protocol";
import { runBotRuntimeHook } from "../../hook/index.js";
import {
  createAgentLifecycleMachine,
  resolveInitialLifecycleState,
} from "../../../runtime/lifecycle/state-machine.js";
import { buildSessionRuntimePluginResolvedEvent } from "./plugin-runtime.js";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";
import { AGENT_CONTEXT_MODE } from "@noobot/context-protocol";

const REQUIRED_RUN_IDENTITY_FIELDS = Object.freeze([
  "presentationMessageId",
  "executionId",
  "executionKind",
  "rootExecutionId",
  "commandId",
]);

function requireAcceptedRunIdentity(runConfig) {
  const missing = REQUIRED_RUN_IDENTITY_FIELDS.filter((field) => !text(runConfig?.[field]));
  if (missing.length > 0) {
    const error = new Error(`session run requires accepted identity: ${missing.join(",")}`);
    error.statusCode = 400;
    error.code = "MISSING_ACCEPTED_RUN_IDENTITY";
    throw error;
  }
  return { presentationMessageId: runConfig.presentationMessageId };
}

export async function initializeSessionRun({
  normalizeRunMessage,
  validateRunInput,
  assertReusedUserTurnIdentity,
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
  requestedDialogProcessId,
  abortSignal,
  runConfig,
  requestedTurnScopeId,
  persistenceScope,
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
    if (!isFunction(assertReusedUserTurnIdentity)) {
      throw new Error("assertReusedUserTurnIdentity is required before reused Turn initialization");
    }
    await assertReusedUserTurnIdentity({
      userId,
      sessionId,
      turnScopeId: normalizedRequestTurnScopeId,
      dialogProcessId: text(requestedDialogProcessId),
      persistenceScope,
    });
  }
  const initialized = await initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId,
    caller,
    eventListener,
    dialogProcessId: requestedDialogProcessId,
    turnScopeId: normalizedRequestTurnScopeId,
    persistenceScope,
  });
  const {
    usedSessionId,
    parentSessionId: resolvedParentSessionId,
    dialogProcessId,
    sessionLoadState,
    userConfig,
    currentSessionModelAlias,
    sessionDir,
    runtimeEventListener,
  } = initialized;
  const scenarioResolvedRunConfig = resolveScenarioRunConfig(runConfig, userConfig);
  const resolvedRunConfig = prepareRunConfig({
    userId,
    runConfig: scenarioResolvedRunConfig,
    userConfig,
  });

  assertNoHookRuntimeIdentityFields(resolvedRunConfig, "runConfig");
  const turnScopeId = normalizedRequestTurnScopeId;
  const { presentationMessageId } = requireAcceptedRunIdentity(resolvedRunConfig);
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
    botHookManager: resolvedRunConfig.botHookManager,
  };
  const botHookIdentity = createHookRuntimeIdentity({
    userId,
    sessionId: usedSessionId,
    parentSessionId: resolvedParentSessionId,
    dialogProcessId,
    turnScopeId,
    caller,
  });
  const botHookBase = withHookRuntimeIdentity(botHookIdentity, { runConfig: resolvedRunConfig });
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
    usedSessionId,
    parentSessionId: resolvedParentSessionId,
    dialogProcessId,
    sessionLoadState,
    userConfig,
    sessionDir,
    runtimeEventListener,
    resolvedRunConfig,
    turnScopeId,
    presentationMessageId,
    resumeFromStoppedSnapshot,
    contextMode:
      sessionLoadState === "loaded"
        ? AGENT_CONTEXT_MODE.EXISTING_SESSION
        : AGENT_CONTEXT_MODE.NEW_SESSION,
    lifecycle,
    botHookRuntime,
    botHookIdentity,
    botHookBase,
  };
}
