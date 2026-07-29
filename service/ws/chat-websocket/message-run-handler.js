/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_CHANNELS, writeRoutedRuntimeEvent } from "@noobot/runtime-events";
import { attachRunTransport, findActiveRun, publishRunEvent, registerActiveRun } from "./run-registry.js";
import { recordServiceWebSocketLifecycle, summarizeDebugAttachments } from "./runtime-events.js";
import { isPluginDebugEnabled, resolveEffectiveRunTimeoutMs, resolveEffectiveStreamingEnabled, summarizePluginConfig } from "./run-config.js";
import { isUserStopRunAbort } from "./stop-lifecycle.js";
import { createRunEventListener } from "./run-event-listener.js";
import { createCommittedTurnLifecyclePublisher } from "./turn-lifecycle-bridge.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/shared/turn-lifecycle-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createAgentApplication } from "#agent/application";

export function createMessageRunHandler({
  state, authInfo, sendEvent, translateText, normalizeLocale, normalizeRunConfig, isForbiddenUserScope,
  resolveBot, sessionLogConfig, userInteractionBridge, buildRunStateSnapshot,
  finalizeTimeout, finalizeUserStopped, finalizeCompleted, commitTurnLifecycle,
}) {
  const canonicalRunOwnerId = String(authInfo?.userId || "").trim();
  const publishCommittedTurnLifecycle = createCommittedTurnLifecyclePublisher({ sendEvent });
  const recoverOrphanedTurnConflict = async ({ accepted = null, userId = "", sessionId = "", parentSessionId = "" } = {}) => {
    if (accepted?.reason !== "session_action_conflict") return false;
    const lifecycle = accepted?.lifecycle;
    const activeTurnScopeId = String(lifecycle?.activeTurnScopeId || "").trim();
    const activeTurn = lifecycle?.turns?.[activeTurnScopeId] || null;
    if (!activeTurnScopeId || !activeTurn) return false;
    if (findActiveRun({ userId: canonicalRunOwnerId, sessionId, turnScopeId: activeTurnScopeId })) return false;
    const updatedAtMs = Date.parse(String(activeTurn?.updatedAt || ""));
    if (
      !Number.isFinite(updatedAtMs) ||
      Date.now() - updatedAtMs < TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs
    ) {
      return false;
    }
    const phase = Object.values(TURN_PHASE).includes(activeTurn?.phase)
      ? activeTurn.phase
      : TURN_PHASE.PROCESSING;
    const failed = await commitTurnLifecycle({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId: activeTurnScopeId,
      dialogProcessId: String(activeTurn?.dialogProcessId || "").trim(),
      commandId: `orphaned:${activeTurnScopeId}:failed:${phase}`,
      eventType: TURN_EVENT.FAILED,
      phase,
      failure: {
        phase,
        code: "service_restart_orphaned_turn",
        message: "active turn execution was lost after service restart",
        retryable: false,
      },
    });
    return failed?.applied === true || failed?.deduplicated === true;
  };
  const commitCurrentFailure = async (error, fallbackPhase = TURN_PHASE.ACTION) => {
    const phase = state.currentLifecyclePhase || fallbackPhase;
    const commandBase = String(state.currentLifecycleCommandId || state.currentTurnScopeId || "turn").trim();
    const failed = await commitTurnLifecycle({
      userId: state.currentRunMeta?.userId || String(authInfo?.userId || "").trim(),
      sessionId: state.currentRunMeta?.sessionId || "",
      parentSessionId: state.currentRunMeta?.parentSessionId || "",
      turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
      dialogProcessId: state.currentRunMeta?.dialogProcessId || "",
      commandId: `${commandBase}:failed:${phase}`,
      eventType: TURN_EVENT.FAILED,
      phase,
      failure: {
        phase,
        code: String(error?.errorCode || error?.code || "turn_failed").trim(),
        message: String(error?.message || "turn failed"),
        retryable: false,
      },
    });
    return failed;
  };

  const handleRun = async (payload, { isContinueAction }) => {
    const {
      userId,
      sessionId,
      parentSessionId = "",
      dialogProcessId = "",
      parentDialogProcessId = "",
      message,
      attachments = [],
      config = {},
      turnScopeId = "",
      userMessageId = "",
      presentationMessageId = "",
      idempotencyKey = "",
      expectedVersion = undefined,
    } = payload || {};
    state.currentTurnScopeId =
      String(turnScopeId || config?.turnScopeId || "").trim() || state.currentTurnScopeId;
    state.currentLocale = normalizeLocale(config?.locale || state.currentLocale);

    void writeRoutedRuntimeEvent(
      {
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.SYSTEM,
        event: "debug.resend.websocket.received",
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        parentSessionId: String(parentSessionId || "").trim(),
        turnScopeId: String(state.currentTurnScopeId || turnScopeId || config?.turnScopeId || "").trim(),
        data: {
          reuseExistingUserTurn: config?.reuseExistingUserTurn === true,
          hasPayloadThinkingStartedAt: Boolean(String(config?.thinkingStartedAt || "").trim()),
          payloadThinkingStartedAt: String(config?.thinkingStartedAt || "").trim(),
          attachments: summarizeDebugAttachments(attachments),
          payloadAttachments: summarizeDebugAttachments(payload?.attachments),
        },
      },
      sessionLogConfig,
    );

    if (!userId || !sessionId || !message) {
      throw new Error(translateText("common.userSessionMessageRequired", state.currentLocale));
    }
    if (isForbiddenUserScope(authInfo, userId)) {
      throw new Error(translateText("auth.forbiddenUserScope", state.currentLocale));
    }
    const normalizedRunConfig = {
      ...normalizeRunConfig(config),
      turnScopeId: String(turnScopeId || config?.turnScopeId || "").trim(),
      userMessageId: String(userMessageId || config?.userMessageId || "").trim(),
      presentationMessageId: String(
        presentationMessageId || config?.presentationMessageId || "",
      ).trim(),
      idempotencyKey: String(
        idempotencyKey || config?.idempotencyKey || turnScopeId || config?.turnScopeId || "",
      ).trim(),
      expectedVersion,
    };

    const runningTurn = findActiveRun({
      userId: canonicalRunOwnerId,
      sessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId,
    });
    if (runningTurn && !runningTurn.abortController?.signal?.aborted) {
      state.currentRunHandle = runningTurn;
      state.currentRunTransportBinding = attachRunTransport(runningTurn, sendEvent);
      sendEvent("channel_state", {
        sessionId,
        dialogProcessId: runningTurn.dialogProcessId || dialogProcessId || "",
        turnScopeId: state.currentTurnScopeId,
        state: "sending",
        sourceEvent: "running_transport_rebound",
      });
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        event: "service.websocket.run.transportRebound",
        userId,
        sessionId,
        dialogProcessId: runningTurn.dialogProcessId || dialogProcessId || "",
        turnScopeId: state.currentTurnScopeId,
      });
      return { rebound: true };
    }
    if (isContinueAction) {
      const resumeDialogProcessId = String(config?.resumeDialogProcessId || "").trim();
      const resumeTurnScopeId = String(config?.resumeTurnScopeId || config?.stoppedTurnScopeId || "").trim();
      normalizedRunConfig.resumeFromStoppedSnapshot = true;
      normalizedRunConfig.resumeDialogProcessId = resumeDialogProcessId;
      normalizedRunConfig.resumeTurnScopeId = resumeTurnScopeId;
      if (!normalizedRunConfig.resumeDialogProcessId || !normalizedRunConfig.resumeTurnScopeId) {
        throw new Error("continue requires resumeDialogProcessId and resumeTurnScopeId");
      }
    }
    const action = isContinueAction
      ? "continue"
      : normalizedRunConfig.reuseExistingUserTurn === true
        ? "resend"
        : "send";
    const commandId = String(payload?.commandId || normalizedRunConfig.idempotencyKey || state.currentTurnScopeId).trim();
    normalizedRunConfig.presentationMessageId = String(
      normalizedRunConfig.presentationMessageId || `msg_${state.currentTurnScopeId}`,
    ).trim();
    normalizedRunConfig.messageId = String(
      normalizedRunConfig.messageId ||
        `msg_event_${normalizedRunConfig.presentationMessageId || state.currentTurnScopeId}`,
    ).trim();
    const actionEvent = {
      userId,
      sessionId,
      parentSessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId,
      commandId,
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action,
      messageId: normalizedRunConfig.messageId,
      presentationMessageId: normalizedRunConfig.presentationMessageId,
      startedAt: String(normalizedRunConfig?.thinkingStartedAt || "").trim(),
      createSessionIfAbsent: action === "send",
      expectedRevision: payload?.expectedRevision ?? 0,
    };
    let accepted = await commitTurnLifecycle(actionEvent);
    if (
      !accepted?.applied &&
      !accepted?.deduplicated &&
      await recoverOrphanedTurnConflict({ accepted, userId, sessionId, parentSessionId })
    ) {
      accepted = await commitTurnLifecycle(actionEvent);
    }
    if (!accepted?.applied && !accepted?.deduplicated) {
      const error = new Error(accepted?.reason || "action_rejected");
      error.errorCode = accepted?.reason || "action_rejected";
      error.currentVersion = accepted?.currentRevision;
      throw error;
    }
    state.currentLifecycleCommandId = commandId;
    state.currentLifecyclePhase = TURN_PHASE.ACTION;
    state.isRunning = true;
    state.currentAbortController = new AbortController();
    state.currentRunTimedOut = false;
    state.currentAbortSignal = state.currentAbortController.signal;
    if (isPluginDebugEnabled()) {
      await writeRoutedRuntimeEvent({
        scope: "session",
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: "debug",
        event: "service.websocket.pluginDebug.runConfig",
        userId: String(userId || "").trim(),
        sessionId: String(sessionId || "").trim(),
        dialogProcessId: "",
        turnScopeId: String(normalizedRunConfig?.turnScopeId || state.currentTurnScopeId || "").trim(),
        data: {
          payloadSelectedPlugins: config?.selectedPlugins,
          normalizedSelectedPlugins: normalizedRunConfig?.selectedPlugins,
          normalizedPlugins: summarizePluginConfig(normalizedRunConfig?.plugins),
          hasPayloadThinkingStartedAt: Boolean(String(config?.thinkingStartedAt || "").trim()),
          payloadThinkingStartedAt: String(config?.thinkingStartedAt || "").trim(),
          normalizedThinkingStartedAt: String(normalizedRunConfig?.thinkingStartedAt || "").trim(),
        },
      });
    }
    const activeBot = resolveBot();
    const runTimeoutMs = await resolveEffectiveRunTimeoutMs({
      bot: activeBot,
      userId,
      runConfig: normalizedRunConfig,
    });
    state.currentRunTimeoutTimer = setTimeout(() => {
      state.currentRunTimedOut = true;
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        event: "service.websocket.run.timeout",
        userId: state.currentRunMeta?.userId || userId,
        sessionId: state.currentRunMeta?.sessionId || sessionId,
        dialogProcessId: state.currentRunMeta?.dialogProcessId || "",
        turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId,
        data: { timeoutMs: runTimeoutMs },
      });
      if (state.currentAbortController) {
        state.currentAbortController.abort({
          type: "run_timeout",
          reason: `run timeout after ${runTimeoutMs}ms`,
          timeoutMs: runTimeoutMs,
        });
      }
    }, runTimeoutMs);
    state.currentRunMeta = {
      userId: String(userId || "").trim(),
      runOwnerId: canonicalRunOwnerId,
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(parentSessionId || "").trim(),
      parentDialogProcessId: String(parentDialogProcessId || "").trim(),
      dialogProcessId: "",
      turnScopeId: String(normalizedRunConfig?.turnScopeId || state.currentTurnScopeId || "").trim(),
    };
    state.currentRunHandle = registerActiveRun({
      userId: state.currentRunMeta.runOwnerId,
      sessionId: state.currentRunMeta.sessionId,
      dialogProcessId: state.currentRunMeta.dialogProcessId,
      turnScopeId: state.currentRunMeta.turnScopeId,
      abortController: state.currentAbortController,
      stopRequested: false,
      stopPayload: null,
    });
    state.currentRunTransportBinding = attachRunTransport(state.currentRunHandle, sendEvent);
    if (state.stopRequested && state.currentAbortController && !state.currentAbortController.signal?.aborted) {
      if (state.currentRunHandle) {
        state.currentRunHandle.stopRequested = true;
        state.currentRunHandle.stopPayload = state.currentStopPayload;
      }
      state.currentAbortController.abort({
        type: "user_stop",
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      });
    }
    if (state.stopRequested && state.currentStopPayload) {
      sendEvent("channel_state", {
        ...state.currentStopPayload,
        sessionId: state.currentStopPayload?.sessionId || state.currentRunMeta?.sessionId || "",
        dialogProcessId:
          state.currentStopPayload?.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
        turnScopeId: state.currentStopPayload?.turnScopeId || state.currentRunMeta?.turnScopeId || "",
        state: "stopping",
        sourceEvent: "stop_requested",
      });
    } else if (isContinueAction) {
      sendEvent("channel_state", {
        sessionId: state.currentRunMeta?.sessionId || "",
        turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
        state: "sending",
        sourceEvent: "continue_started",
        resumeDialogProcessId: normalizedRunConfig?.resumeDialogProcessId || "",
        resumeTurnScopeId: normalizedRunConfig?.resumeTurnScopeId || "",
      });
    }

    const textStreamingEnabled = await resolveEffectiveStreamingEnabled({
      bot: activeBot,
      userId,
      runConfig: normalizedRunConfig,
    });
    let processingStartedPromise = null;
    const eventListener = createRunEventListener({
      sendEvent: (...args) => publishRunEvent(state.currentRunHandle, ...args),
      sessionId,
      textStreamingEnabled,
      registerActiveRun,
      getCurrentRunMeta: () => state.currentRunMeta,
      getCurrentRunHandle: () => state.currentRunHandle,
      getCurrentTurnScopeId: () => state.currentTurnScopeId,
      onEventReceived: (eventData = {}) => {
        const eventType = String(eventData.eventType || eventData.eventName || "").trim();
        if (
          eventType === "workflow_planning_message_prepared" ||
          eventType === "workflow_node_state_committed"
        ) {
          void recordServiceWebSocketLifecycle({
            sessionLogConfig,
            category: "debug",
            level: "debug",
            debugType: "workflow-diagnostics",
            event: "service.workflowTransport.sourceEventReceived",
            userId,
            sessionId: eventData.sessionId || sessionId,
            dialogProcessId: eventData.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
            turnScopeId: eventData.turnScopeId || state.currentTurnScopeId || "",
            data: eventData,
          });
          return;
        }
        if (
          eventType !== "tool_call_start" &&
          eventType !== "tool_call_end" &&
          eventType !== "main_model_content" &&
          eventType !== "guidance_analysis_response" &&
          eventType !== "guidance_analysis" &&
          eventType !== "timeline_checkpoint_persisted"
        ) return;
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          category: "debug",
          level: "debug",
          debugType: "timeline-pipeline",
          event: eventType === "timeline_checkpoint_persisted"
            ? "service.timelinePipeline.checkpointPersisted"
            : eventType === "guidance_analysis_response" || eventType === "guidance_analysis"
              ? "service.timelinePipeline.activityReceived"
            : "service.websocket.runEvent.timelineReceived",
          userId,
          sessionId: eventData.sessionId || sessionId,
          dialogProcessId: eventData.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
          turnScopeId: eventData.turnScopeId || state.currentTurnScopeId || "",
          data: eventData,
        });
      },
      onAuthoritativeMessageRouted: (routeData = {}) => {
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          category: "debug",
          level: "debug",
          debugType: "workflow-diagnostics",
          event: "service.websocket.authoritativeMessage.routed",
          userId,
          sessionId,
          dialogProcessId: routeData.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
          turnScopeId: routeData.turnScopeId || state.currentTurnScopeId || "",
          data: routeData,
        });
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          category: "debug",
          level: "debug",
          debugType: "timeline-pipeline",
          event: "service.timelinePipeline.authoritativeRouted",
          userId,
          sessionId,
          dialogProcessId: routeData.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
          turnScopeId: routeData.turnScopeId || state.currentTurnScopeId || "",
          data: routeData,
        });
      },
      onCommittedTurnLifecycle: (committed = {}) => {
        publishCommittedTurnLifecycle({
          event: committed,
          turn: committed?.turn,
        });
      },
      onRootRunning: (lifecycleData) => {
        if (processingStartedPromise) return processingStartedPromise;
        processingStartedPromise = commitTurnLifecycle({
          userId,
          sessionId,
          parentSessionId,
          turnScopeId: state.currentTurnScopeId,
          dialogProcessId: lifecycleData?.dialogProcessId || state.currentRunMeta?.dialogProcessId || dialogProcessId,
          commandId: `${commandId}:processing-started`,
          eventType: TURN_EVENT.PROCESSING_STARTED,
          phase: TURN_PHASE.PROCESSING,
          executionState: "sending",
          executionId: lifecycleData?.executionId,
          executionKind: lifecycleData?.executionKind,
          parentExecutionId: lifecycleData?.parentExecutionId,
          rootExecutionId: lifecycleData?.rootExecutionId,
          origin: lifecycleData?.origin,
          stage: lifecycleData?.stage,
        }).then((started) => {
          if (!started?.applied && !started?.deduplicated) {
            throw new Error(started?.reason || "processing_start_failed");
          }
          state.currentLifecyclePhase = TURN_PHASE.PROCESSING;
          sendEvent("channel_state", {
            sessionId,
            turnScopeId: state.currentTurnScopeId,
            state: "sending",
            sourceEvent: "processing_started",
          });
          return started;
        });
        void processingStartedPromise.catch((error) => {
          void recordServiceWebSocketLifecycle({
            sessionLogConfig,
            event: "service.websocket.processingStart.persistenceFailed",
            userId,
            sessionId,
            dialogProcessId: lifecycleData?.dialogProcessId || "",
            turnScopeId: state.currentTurnScopeId,
            data: { errorType: error?.name || "Error", errorCode: String(error?.code || "") },
          });
        });
        return processingStartedPromise;
      },
    });

    const agentApplication = createAgentApplication({ runtime: activeBot });
    const result = await agentApplication.run({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      caller: "user",
      message,
      attachments,
      eventListener,
      abortSignal: state.currentAbortSignal,
      userInteractionBridge,
      runConfig: normalizedRunConfig,
    });

    if (processingStartedPromise) await processingStartedPromise;

    if (state.currentRunTimedOut && state.currentAbortSignal?.aborted) {
      await finalizeTimeout(buildRunStateSnapshot(), {
        description: `run timeout after ${runTimeoutMs}ms`,
        errorObject: { message: `run timeout after ${runTimeoutMs}ms`, code: "run_timeout" },
      });
      return;
    }

    if (isUserStopRunAbort({ stopRequested: state.stopRequested, abortSignal: state.currentAbortSignal })) {
      await finalizeUserStopped(buildRunStateSnapshot(), { result });
      return;
    }

    const processed = await commitTurnLifecycle({
      userId,
      sessionId: result?.sessionId || sessionId,
      parentSessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId: result?.dialogProcessId || state.currentRunMeta?.dialogProcessId || dialogProcessId,
      commandId: `${commandId}:processing-completed`,
      eventType: TURN_EVENT.PROCESSING_COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    });
    if (!processed?.applied && !processed?.deduplicated) throw new Error(processed?.reason || "processing_completion_failed");
    state.currentLifecyclePhase = TURN_PHASE.COMPLETION;

    await finalizeCompleted(buildRunStateSnapshot(), { result, commandId });
  };
  return { handleRun, commitCurrentFailure };
}
