/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { runBotRuntimeHook } from "../hook/index.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { CALLER_ROLE } from "../config/constants.js";
import { syncLifecycleRuntimeState } from "../../runtime/lifecycle/state-machine.js";
import { saveStoppedModelMessageSnapshotCandidate } from "../../runtime/resume/model-message-snapshot-store.js";
import { summarizeDebugAttachments } from "./runner/debug-utils.js";
import { dispatchAgentTurn } from "./runner/agent-dispatch.js";
import {
  buildAgentContextSummary,
  normalizePreparedAgentTurnExecution,
} from "./runner/agent-context-projection.js";
import { prepareCurrentUserTurn } from "./runner/current-user-turn.js";
import { bindAgentDispatchRuntime } from "./runner/runtime-binding.js";
import { handleSessionRunFailure } from "./runner/run-failure.js";
import { initializeSessionRun } from "./runner/run-initialization.js";
import { finalizeAgentTurn } from "./runner/result-finalizer.js";
import { commitAuthoritativeFinalResult } from "../../runtime/engine.js";

export class SessionExecutionRunner {
  constructor({
    agentRunner,
    errorLogger,
    normalizeRunMessage,
    validateRunInput,
    ensureParentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    prepareTurnInput,
    prepareAgentTurnExecution,
    commitSummaryCheckpoint,
    appendAgentMessages,
    assertPersistenceContextIdentity,
    commitSessionTurn,
    bindSessionTurnAttachments,
    assertReusedUserTurnIdentity,
    getSessionTurns,
    getTurnSummaryCheckpointState,
    finalizeRunSession,
    upsertParentAsyncTask,
    now,
  } = {}) {
    this.agentRunner = agentRunner;
    this.errorLogger = errorLogger;
    this.normalizeRunMessage = normalizeRunMessage;
    this.validateRunInput = validateRunInput;
    this.ensureParentAsyncResultContainer = ensureParentAsyncResultContainer;
    this.initializeRunSessionRuntime = initializeRunSessionRuntime;
    this.resolveScenarioRunConfig = resolveScenarioRunConfig;
    this.prepareRunConfig = prepareRunConfig;
    this.prepareTurnInput = prepareTurnInput;
    this.prepareAgentTurnExecution = prepareAgentTurnExecution;
    this.commitSummaryCheckpoint = commitSummaryCheckpoint;
    this.appendAgentMessages = appendAgentMessages;
    this.assertPersistenceContextIdentity = assertPersistenceContextIdentity;
    this.commitSessionTurn = commitSessionTurn;
    this.bindSessionTurnAttachments = bindSessionTurnAttachments;
    this.assertReusedUserTurnIdentity = assertReusedUserTurnIdentity;
    this.getSessionTurns = getSessionTurns;
    this.getTurnSummaryCheckpointState = getTurnSummaryCheckpointState;
    this.finalizeRunSession = finalizeRunSession;
    this.upsertParentAsyncTask = upsertParentAsyncTask;
    this.now = now;
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    systemMessages = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    dialogProcessId: requestedDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    turnAcceptance = null,
    turnScopeId = "",
    parentAsyncResultContainer = null,
    persistenceContext = null,
    persistenceScope = null,
  }) {
    this.assertPersistenceContextIdentity?.(persistenceContext, {
      userId,
      sessionId,
      parentSessionId,
      scopeId: String(runConfig?.executionId || "").trim(),
    });
    let resolvedParentAsyncResultContainer = parentAsyncResultContainer;
    let resolvedRunConfig = runConfig;
    let resolvedUsedSessionId = sessionId;
    let resolvedDialogProcessId = parentDialogProcessId;
    let resolvedRuntimeEventListener = eventListener;
    let lifecycle = null;
    let lifecycleRuntime = null;
    let pluginActivationScope = null;
    const persistStoppedSnapshotFromRuntime = (source = "") => {
      return saveStoppedModelMessageSnapshotCandidate({
        globalConfig: lifecycleRuntime?.globalConfig || {},
        candidate: lifecycleRuntime?.stoppedModelMessageSnapshotCandidate,
        eventListener: resolvedRuntimeEventListener,
        source,
      });
    };
    try {
      const initializedRun = await initializeSessionRun({
        normalizeRunMessage: this.normalizeRunMessage,
        validateRunInput: this.validateRunInput,
        assertReusedUserTurnIdentity: this.assertReusedUserTurnIdentity,
        ensureParentAsyncResultContainer: this.ensureParentAsyncResultContainer,
        initializeRunSessionRuntime: this.initializeRunSessionRuntime,
        resolveScenarioRunConfig: this.resolveScenarioRunConfig,
        prepareRunConfig: this.prepareRunConfig,
        now: () => this.now(),
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
        requestedTurnScopeId: turnScopeId,
        parentAsyncResultContainer,
        persistenceContext,
      });
      const {
        normalizedMessage,
        resolvedParentAsyncResultContainer: initializedParentAsyncResultContainer,
        usedSessionId,
        dialogProcessId,
        sessionLoadState,
        userConfig,
        executionStartIndex,
        runtimeEventListener,
        requestRunConfig,
        scenarioResolvedRunConfig,
        resolvedRunConfig: initializedRunConfig,
        turnScopeId: resolvedTurnScopeId,
        presentationMessageId,
        messageId,
        resumeFromStoppedSnapshot,
        contextMode,
        lifecycle: initializedLifecycle,
        botHookRuntime,
        botHookBase,
      } = initializedRun;
      resolvedParentAsyncResultContainer = initializedParentAsyncResultContainer;
      resolvedRunConfig = initializedRunConfig;
      pluginActivationScope = initializedRunConfig?.pluginActivationScope || null;
      delete initializedRunConfig.pluginActivationScope;
      resolvedUsedSessionId = usedSessionId;
      resolvedDialogProcessId = dialogProcessId;
      resolvedRuntimeEventListener = runtimeEventListener;
      lifecycle = initializedLifecycle;

      const {
        buildContextPayload,
        canonicalAttachments,
        currentUserMessage,
        turnCommand: effectiveTurnCommand,
        committedTurnResult,
      } = await prepareCurrentUserTurn({
        prepareTurnInput: this.prepareTurnInput,
        assertReusedUserTurnIdentity: this.assertReusedUserTurnIdentity,
        commitSessionTurn: this.commitSessionTurn,
        bindSessionTurnAttachments: this.bindSessionTurnAttachments,
        normalizedMessage,
        attachments,
        systemMessages,
        eventListener: runtimeEventListener,
        userInteractionBridge,
        abortSignal,
        parentAsyncResultContainer: resolvedParentAsyncResultContainer,
        persistenceContext,
        contextMode,
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        caller,
        userConfig,
        resolvedRunConfig,
        requestRunConfig,
        scenarioResolvedRunConfig,
        turnAcceptance,
      });
      if (typeof this.prepareAgentTurnExecution !== "function") {
        throw new Error("prepareAgentTurnExecution is required");
      }
      const preparedAgentTurnExecution = await this.prepareAgentTurnExecution({
        buildContextPayload,
        abortSignal,
        persistenceContext,
      });
      const { runtimeAgentContext, userMessageAttachments } = normalizePreparedAgentTurnExecution(
        preparedAgentTurnExecution,
      );
      const dispatchRuntime = await bindAgentDispatchRuntime({
        runtimeAgentContext,
        botHookRuntime,
        lifecycle,
        messageId,
        presentationMessageId,
        userMessageAttachments,
        appendAgentMessages: this.appendAgentMessages,
        getSessionTurns: this.getSessionTurns,
        commitSummaryCheckpoint: this.commitSummaryCheckpoint,
        userId,
        sessionId: usedSessionId,
        parentSessionId,
        dialogProcessId,
        parentDialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        eventListener: runtimeEventListener,
        persistenceContext,
        persistenceScope,
        normalizedMessage,
        requestedAttachments: attachments,
        canonicalAttachments,
        currentUserMessage,
        resolvedRunConfig,
        turnCommand: effectiveTurnCommand,
        committedTurnResult,
      });
      if (dispatchRuntime && typeof dispatchRuntime === "object") {
        lifecycleRuntime = dispatchRuntime;
      }
      emitEvent(runtimeEventListener, "debug_resend_runner_prepared", {
        sessionId: usedSessionId,
        dialogProcessId,
        turnScopeId: resolvedTurnScopeId,
        resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
        reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
        requestAttachments: summarizeDebugAttachments(attachments),
        userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
      });
      if (resolvedRunConfig?.reuseExistingUserTurn === true) {
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_before_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
          attachments: summarizeDebugAttachments(userMessageAttachments),
        });
        emitEvent(runtimeEventListener, "debug_resend_runner_reuse_after_stamp", {
          sessionId: usedSessionId,
          dialogProcessId,
          turnScopeId: resolvedTurnScopeId,
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
        abortSignal,
        normalizedMessage,
        currentUserMessage,
        userMessageAttachments,
        resolvedRunConfig,
        runtimeEventListener,
        botHookRuntime,
        botHookBase,
        agentContextSummary,
        usedSessionId,
        dialogProcessId,
        resolvedTurnScopeId,
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
        parentSessionId,
        parentDialogProcessId,
        caller,
        agentResult,
        executionStartIndex,
        userConfig,
        resolvedParentAsyncResultContainer,
        lifecycle,
        persistenceContext,
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
      return finalizedResult;
    } catch (error) {
      return handleSessionRunFailure({
        error,
        abortSignal,
        lifecycle,
        lifecycleRuntime,
        persistStoppedSnapshotFromRuntime,
        resolvedRuntimeEventListener,
        resolvedRunConfig,
        resolvedUsedSessionId,
        resolvedDialogProcessId,
        resolvedParentAsyncResultContainer,
        upsertParentAsyncTask: this.upsertParentAsyncTask,
        errorLogger: this.errorLogger,
        now: this.now,
        userId,
        sessionId,
        parentSessionId,
        caller,
        message,
      });
    } finally {
      pluginActivationScope?.dispose();
    }
  }
}
