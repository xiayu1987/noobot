/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { runBotRuntimeHook } from "../hook/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { syncLifecycleRuntimeState } from "../../runtime/lifecycle/state-machine.js";
import { saveStoppedModelMessageSnapshotFromRuntime } from "../../runtime/resume/model-message-snapshot-store.js";
import { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
import { dispatchAgentTurn } from "./runner/agent-dispatch.js";
import {
  buildAgentContextSummary,
  requirePreparedAgentTurnExecution,
} from "./runner/agent-context-projection.js";
import { prepareCurrentUserTurn } from "./runner/current-user-turn.js";
import { bindAgentDispatchRuntime } from "./runner/runtime-binding.js";
import { handleSessionRunFailure } from "./runner/run-failure.js";
import { initializeSessionRun } from "./runner/run-initialization.js";
import { finalizeAgentTurn } from "./runner/result-finalizer.js";
import { commitAuthoritativeFinalResult } from "../../runtime/engine.js";
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { text, isFunction, isPlainObject } from "@noobot/shared/value";

const SESSION_RUN_PAYLOAD_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "message",
  "attachments",
  "systemMessages",
  "eventListener",
  "caller",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "abortSignal",
  "userInteractionBridge",
  "userInterjectionPort",
  "runConfig",
  "turnAcceptance",
  "turnScopeId",
  "persistenceScope",
]);

function assertSessionRunPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("session run payload must be an object");
  }
  const missing = SESSION_RUN_PAYLOAD_FIELDS.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length) {
    throw new TypeError(`session run payload requires: ${missing.join(",")}`);
  }
  const unknown = Object.keys(payload).filter(
    (field) => !SESSION_RUN_PAYLOAD_FIELDS.includes(field),
  );
  if (unknown.length) {
    throw new TypeError(`session run payload has unknown fields: ${unknown.join(",")}`);
  }
  for (const field of ["attachments", "systemMessages"]) {
    if (!Array.isArray(payload[field])) {
      throw new TypeError(`session run payload ${field} must be an array`);
    }
  }
  if (!isPlainObject(payload.runConfig)) {
    throw new TypeError("session run payload runConfig must be a plain object");
  }
  for (const field of ["parentDialogProcessId", "dialogProcessId", "turnScopeId"]) {
    if (typeof payload[field] !== "string") {
      throw new TypeError(`session run payload ${field} must be a string`);
    }
  }
}

export class SessionExecutionRunner {
  constructor({
    agentRunner,
    errorLogger,
    normalizeRunMessage,
    validateRunInput,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    buildContextBuilder,
    prepareTurnInput,
    prepareAgentTurnExecution,
    commitSummaryCheckpoint,
    appendAgentMessages,
    bindSessionTurnAttachments,
    assertReusedUserTurnIdentity,
    getSessionTurns,
    getTurnSummaryCheckpointState,
    finalizeRunSession,
    saveExecutionReport,
    getExecutionTurnLogs,
    now,
  } = {}) {
    for (const [name, dependency] of Object.entries({
      agentRunner,
      prepareRunConfig,
      buildContextBuilder,
      prepareTurnInput,
      assertReusedUserTurnIdentity,
      bindSessionTurnAttachments,
      saveExecutionReport,
      getExecutionTurnLogs,
    })) {
      if (!isFunction(dependency)) throw new TypeError(`${name} is required`);
    }
    this.agentRunner = agentRunner;
    this.errorLogger = errorLogger;
    this.normalizeRunMessage = normalizeRunMessage;
    this.validateRunInput = validateRunInput;
    this.initializeRunSessionRuntime = initializeRunSessionRuntime;
    this.resolveScenarioRunConfig = resolveScenarioRunConfig;
    this.prepareRunConfig = prepareRunConfig;
    this.buildContextBuilder = buildContextBuilder;
    this.prepareTurnInput = prepareTurnInput;
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.commitSummaryCheckpoint = commitSummaryCheckpoint;
    this.appendAgentMessages = appendAgentMessages;
    this.bindSessionTurnAttachments = bindSessionTurnAttachments;
    this.assertReusedUserTurnIdentity = assertReusedUserTurnIdentity;
    this.getSessionTurns = getSessionTurns;
    this.getTurnSummaryCheckpointState = getTurnSummaryCheckpointState;
    this.finalizeRunSession = finalizeRunSession;
    this.saveExecutionReport = saveExecutionReport;
    this.getExecutionTurnLogs = getExecutionTurnLogs;
    this.now = now;
  }

  async runSession(payload) {
    assertSessionRunPayload(payload);
    const {
      userId,
      sessionId,
      message,
      attachments,
      systemMessages,
      eventListener,
      caller,
      parentSessionId,
      parentDialogProcessId,
      dialogProcessId: requestedDialogProcessId,
      abortSignal,
      userInteractionBridge,
      userInterjectionPort,
      runConfig,
      turnAcceptance,
      turnScopeId,
      persistenceScope,
    } = payload;
    if (typeof parentSessionId !== "string") {
      throw new TypeError("session run parentSessionId must be a string");
    }
    const persistenceScopeValidation = validateSessionPersistenceScope(persistenceScope);
    if (!persistenceScopeValidation.valid) {
      throw new TypeError(
        `invalid Session persistence scope: ${persistenceScopeValidation.errors.join(",")}`,
      );
    }
    let resolvedRunConfig = runConfig;
    let preparedBotHookManager = null;
    let resolvedUsedSessionId = sessionId;
    let resolvedDialogProcessId = "";
    let failureTurnScopeId = turnScopeId;
    let resolvedRuntimeEventListener = eventListener;
    let executionEventListener = null;
    let lifecycle = null;
    let lifecycleRuntime = null;
    let pluginActivationScope = null;
    const persistStoppedSnapshotFromRuntime = (source) =>
      saveStoppedModelMessageSnapshotFromRuntime({
        runtime: lifecycleRuntime,
        eventListener: resolvedRuntimeEventListener,
        source,
      });
    try {
      const initializedRun = await initializeSessionRun({
        normalizeRunMessage: this.normalizeRunMessage,
        validateRunInput: this.validateRunInput,
        assertReusedUserTurnIdentity: this.assertReusedUserTurnIdentity,
        initializeRunSessionRuntime: async (payload) => {
          const initialized = await this.initializeRunSessionRuntime(payload);
          executionEventListener = initialized.runtimeEventListener;
          resolvedRuntimeEventListener = initialized.runtimeEventListener;
          resolvedUsedSessionId = initialized.usedSessionId;
          resolvedDialogProcessId = initialized.dialogProcessId;
          return initialized;
        },
        resolveScenarioRunConfig: this.resolveScenarioRunConfig,
        prepareRunConfig: this.prepareRunConfig,
        now: () => this.now(),
        userId,
        sessionId,
        message,
        eventListener,
        caller,
        parentSessionId,
        requestedDialogProcessId,
        abortSignal,
        runConfig,
        requestedTurnScopeId: turnScopeId,
        persistenceScope,
      });
      const {
        normalizedMessage,
        usedSessionId,
        parentSessionId: resolvedParentSessionId,
        dialogProcessId,
        sessionLoadState,
        userConfig,
        sessionDir,
        runtimeEventListener,
        requestRunConfig,
        scenarioResolvedRunConfig,
        resolvedRunConfig: initializedRunConfig,
        turnScopeId: resolvedTurnScopeId,
        presentationMessageId,
        resumeFromStoppedSnapshot,
        contextMode,
        lifecycle: initializedLifecycle,
        botHookRuntime,
        botHookBase,
      } = initializedRun;
      resolvedRunConfig = initializedRunConfig;
      preparedBotHookManager = initializedRunConfig.botHookManager;
      pluginActivationScope = initializedRunConfig?.pluginActivationScope || null;
      delete initializedRunConfig.pluginActivationScope;
      resolvedUsedSessionId = usedSessionId;
      resolvedDialogProcessId = dialogProcessId;
      failureTurnScopeId = resolvedTurnScopeId;
      resolvedRuntimeEventListener = runtimeEventListener;
      lifecycle = initializedLifecycle;

      const { buildContextPayload, canonicalAttachments, currentUserMessage, committedTurnResult } =
        await prepareCurrentUserTurn({
          buildContextBuilder: this.buildContextBuilder,
          prepareTurnInput: this.prepareTurnInput,
          assertReusedUserTurnIdentity: this.assertReusedUserTurnIdentity,
          bindSessionTurnAttachments: this.bindSessionTurnAttachments,
          attachments,
          systemMessages,
          eventListener: runtimeEventListener,
          userInteractionBridge,
          abortSignal,
          persistenceScope: persistenceScopeValidation.scope,
          contextMode,
          userId,
          sessionId: usedSessionId,
          parentSessionId: resolvedParentSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          caller,
          userConfig,
          resolvedRunConfig,
          requestRunConfig,
          scenarioResolvedRunConfig,
          turnAcceptance,
        });
      if (!isFunction(this.prepareAgentTurnExecution)) {
        throw new Error("prepareAgentTurnExecution is required");
      }
      const preparedAgentTurnExecution = await this.prepareAgentTurnExecution({
        buildContextPayload,
      });
      const { agentContext: runtimeAgentContext, userMessageAttachments } =
        requirePreparedAgentTurnExecution(preparedAgentTurnExecution);
      const dispatchRuntime = await bindAgentDispatchRuntime({
        runtimeAgentContext,
        lifecycle,
        presentationMessageId,
        userMessageAttachments,
        appendAgentMessages: this.appendAgentMessages,
        commitSummaryCheckpoint: this.commitSummaryCheckpoint,
        userId,
        sessionId: usedSessionId,
        parentSessionId: resolvedParentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        eventListener: runtimeEventListener,
        persistenceScope,
        sessionDir,
        normalizedMessage,
        requestedAttachments: attachments,
        canonicalAttachments,
        currentUserMessage,
        resolvedRunConfig,
        userInterjectionPort,
        committedTurnResult,
      });
      lifecycleRuntime = dispatchRuntime;
      emitEvent(runtimeEventListener, "debug_resend_runner_prepared", {
        resolvedThinkingStartedAt: text(resolvedRunConfig?.thinkingStartedAt),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        requestAttachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
      });
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_before_stamp", {
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_after_stamp", {
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
      }
      const agentContextSummary = buildAgentContextSummary(runtimeAgentContext);
      const agentResult = await dispatchAgentTurn({
        agentRunner: this.agentRunner,
        errorLogger: this.errorLogger,
        lifecycle,
        dispatchRuntime,
        runtimeAgentContext,
        normalizedMessage,
        currentUserMessage,
        userMessageAttachments,
        resolvedRunConfig,
        runtimeEventListener,
        botHookRuntime,
        botHookBase,
        agentContextSummary,
        syncLifecycleRuntimeState,
      });
      await commitAuthoritativeFinalResult({
        result: agentResult,
        runtime: dispatchRuntime,
      });
      const finalizedResult = await finalizeAgentTurn({
        resolvedRunConfig,
        runtimeEventListener,
        usedSessionId,
        dialogProcessId,
        resolvedTurnScopeId,
        dispatchRuntime,
        getSessionTurns: this.getSessionTurns,
        getTurnSummaryCheckpointState: this.getTurnSummaryCheckpointState,
        finalizeRunSession: this.finalizeRunSession,
        userId,
        parentSessionId: resolvedParentSessionId,
        parentDialogProcessId,
        caller,
        agentResult,
        userConfig,
        lifecycle,
        persistenceScope,
      });
      await runBotRuntimeHook({
        runtime: botHookRuntime,
        point: HOOK_POINT.BOT.AFTER_SESSION_RUN,
        context: {
          ...botHookBase,
          message: normalizedMessage,
          isContinue: resumeFromStoppedSnapshot,
          sessionLoadState,
          resumeFromStoppedSnapshot,
          result: finalizedResult,
        },
        eventListener: runtimeEventListener,
      });
      await runtimeEventListener.flush();
      lifecycle.complete();
      await runtimeEventListener.flush();
      syncLifecycleRuntimeState(lifecycleRuntime, lifecycle);
      return { ...finalizedResult, lifecycle: lifecycle.snapshot };
    } catch (error) {
      return await handleSessionRunFailure({
        error,
        abortSignal,
        executionEventListener,
        lifecycle,
        lifecycleRuntime,
        persistStoppedSnapshotFromRuntime,
        resolvedRuntimeEventListener,
        resolvedRunConfig,
        preparedBotHookManager,
        resolvedUsedSessionId,
        resolvedDialogProcessId,
        saveExecutionReport: this.saveExecutionReport,
        getExecutionTurnLogs: this.getExecutionTurnLogs,
        persistenceScope,
        turnScopeId: failureTurnScopeId,
        errorLogger: this.errorLogger,
        now: this.now,
        userId,
        sessionId,
        parentSessionId,
        caller,
        message,
        userInterjectionPort,
      });
    } finally {
      pluginActivationScope?.dispose();
    }
  }
}
