/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import {
  attachRunTransport,
  findActiveRun,
  publishRunEvent,
  registerActiveRun,
} from "./run-registry.js";
import {
  recordServiceAgentTransportDebug,
  recordServiceWebSocketLifecycle,
  summarizeDebugAttachments,
} from "./runtime-events.js";
import {
  isPluginDebugEnabled,
  resolveEffectiveRunTimeoutMs,
  resolveEffectiveStreamingEnabled,
  summarizePluginConfig,
} from "./run-config.js";
import { isUserStopRunAbort } from "./stop-lifecycle.js";
import { createRunEventListener } from "./run-event-listener.js";
import {
  SESSION_ERROR_CODE,
  TURN_EVENT,
  TURN_PHASE,
  createTurnLifecycleCommandId,
} from "@noobot/session-protocol";
import { recoverOrphanedTurn } from "@noobot/authoritative-state/application";
import { createAgentApplication } from "#agent/application";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";

export function createMessageRunHandler({
  state,
  authInfo,
  sendEvent,
  translateText,
  normalizeLocale,
  mapAgentRunCommand,
  resolveBot,
  sessionLogConfig,
  userInteractionBridge,
  buildRunStateSnapshot,
  finalizeTimeout,
  finalizeUserStopped,
  finalizeCompleted,
  commitTurnLifecycle,
  dispatchAuthorityEvents,
}) {
  const canonicalRunOwnerId = String(authInfo?.userId || "").trim();
  let pendingLifecycleCommit = null;
  let latestAuthorityTurn = null;
  const recoverOrphanedTurnConflict = async ({
    accepted = null,
    userId = "",
    sessionId = "",
    parentSessionId = "",
  } = {}) => {
    const result = await recoverOrphanedTurn({
      conflict: accepted,
      identity: { userId, sessionId, parentSessionId },
      inspectExecution: ({ turnScopeId, dialogProcessId }) => ({
        alive: Boolean(
          findActiveRun({
            userId: canonicalRunOwnerId,
            sessionId,
            turnScopeId,
            dialogProcessId,
          }),
        ),
        observedAtMs: Date.now(),
      }),
      commitTurnLifecycle,
    });
    return result.recovered === true;
  };
  const commitCurrentFailure = async (
    error,
    fallbackPhase = TURN_PHASE.ACTION,
    terminalCommand = "error",
  ) => {
    if (pendingLifecycleCommit) {
      try {
        const pendingResult = await pendingLifecycleCommit;
        if (pendingResult?.turn) latestAuthorityTurn = pendingResult.turn;
      } catch {
        // The failure command below remains responsible for recording the run failure.
      }
    }
    const authoritativePhase = Object.values(TURN_PHASE).includes(latestAuthorityTurn?.phase)
      ? latestAuthorityTurn.phase
      : "";
    const phase = authoritativePhase || state.currentLifecyclePhase || fallbackPhase;
    const commandBase = String(
      state.currentLifecycleCommandId || state.currentTurnScopeId || "turn",
    ).trim();
    const failed = await commitTurnLifecycle({
      userId: state.currentRunMeta?.userId || String(authInfo?.userId || "").trim(),
      sessionId: state.currentRunMeta?.sessionId || "",
      parentSessionId: state.currentRunMeta?.parentSessionId || "",
      turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
      dialogProcessId: state.currentRunMeta?.dialogProcessId || "",
      commandId: createTurnLifecycleCommandId({
        commandId: commandBase,
        eventType: TURN_EVENT.FAILED,
        phase,
      }),
      eventType: TURN_EVENT.FAILED,
      phase,
      failure: {
        phase,
        code: String(error?.errorCode || error?.code || "turn_failed").trim(),
        message: String(error?.message || "turn failed"),
        retryable: false,
      },
      terminalStatus: {
        command: terminalCommand,
        description: String(error?.message || "turn failed"),
        error,
      },
    });
    return failed;
  };

  const recordRunTransportDiagnostic =
    (identity = {}) =>
    (data = {}) => {
      void recordServiceWebSocketLifecycle({
        sessionLogConfig,
        category: "debug",
        level: "debug",
        debugType: "workflow-diagnostics",
        event: `service.websocket.runTransport.${String(data.stage || "observed")}`,
        userId: identity.userId || "",
        sessionId: identity.sessionId || "",
        dialogProcessId: identity.dialogProcessId || "",
        turnScopeId: identity.turnScopeId || "",
        data,
      });
    };
  const handleRun = async (command, { onRunBound = null }) => {
    const {
      userId,
      sessionId,
      parentSessionId = "",
      dialogProcessId = "",
      parentDialogProcessId = "",
      message,
      attachments = [],
      turnScopeId = "",
      runConfig: normalizedRunConfig,
      expectedRevision,
      createSessionIfAbsent,
    } = mapAgentRunCommand(command, { userId: authInfo?.userId });
    state.currentTurnScopeId = String(turnScopeId || "").trim() || state.currentTurnScopeId;
    state.currentLocale = normalizeLocale(normalizedRunConfig.locale || state.currentLocale);

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
        turnScopeId: String(state.currentTurnScopeId || turnScopeId || "").trim(),
        data: {
          commandType: command.commandType,
          reuseExistingUserTurn: normalizedRunConfig.reuseExistingUserTurn === true,
          attachments: summarizeDebugAttachments(attachments),
        },
      },
      sessionLogConfig,
    );

    if (!userId || !sessionId || !message) {
      throw new Error(translateText("common.userSessionMessageRequired", state.currentLocale));
    }
    const runningTurn = findActiveRun({
      userId: canonicalRunOwnerId,
      sessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId,
    });
    if (runningTurn && !runningTurn.abortController?.signal?.aborted) {
      state.currentRunHandle = runningTurn;
      state.currentRunTransportBinding = attachRunTransport(runningTurn, sendEvent, {
        onDiagnostic: recordRunTransportDiagnostic(runningTurn),
      });
      onRunBound?.(runningTurn);
      await dispatchAuthorityEvents?.({ userId, sessionId, parentSessionId });
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
    const authoritativeStartedAt = new Date().toISOString();
    normalizedRunConfig.thinkingStartedAt = authoritativeStartedAt;
    const isContinueCommand = command.commandType === AGENT_COMMAND.CONTINUE;
    const action =
      command.commandType === AGENT_COMMAND.RESEND
        ? "resend"
        : isContinueCommand
          ? "continue"
          : "send";
    const commandId = String(command.commandId).trim();
    normalizedRunConfig.presentationMessageId = String(
      normalizedRunConfig.presentationMessageId || `msg_${state.currentTurnScopeId}`,
    ).trim();
    normalizedRunConfig.messageId = String(
      normalizedRunConfig.messageId ||
        `msg_event_${normalizedRunConfig.presentationMessageId || state.currentTurnScopeId}`,
    ).trim();
    const activeBot = resolveBot();
    const agentApplication = createAgentApplication({ runtime: activeBot });
    const executionIntent = await agentApplication.resolveExecutionIntent({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId: state.currentTurnScopeId,
      runConfig: normalizedRunConfig,
    });
    Object.assign(normalizedRunConfig, executionIntent);
    const actionEvent = {
      userId,
      sessionId,
      parentSessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId,
      commandId: createTurnLifecycleCommandId({
        commandId,
        eventType: TURN_EVENT.ACTION_ACCEPTED,
        phase: TURN_PHASE.ACTION,
      }),
      causationId: commandId,
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      phase: TURN_PHASE.ACTION,
      action,
      messageId: normalizedRunConfig.messageId,
      presentationMessageId: normalizedRunConfig.presentationMessageId,
      startedAt: authoritativeStartedAt,
      createSessionIfAbsent,
      expectedRevision: expectedRevision ?? 0,
      expectedAggregateVersion: normalizedRunConfig.expectedAggregateVersion,
      ...executionIntent,
      ...(isContinueCommand
        ? {
            continuationSource: {
              dialogProcessId: normalizedRunConfig.resumeDialogProcessId,
              turnScopeId: normalizedRunConfig.resumeTurnScopeId,
            },
          }
        : {}),
    };
    let accepted = await commitTurnLifecycle(actionEvent);
    if (
      !accepted?.applied &&
      !accepted?.deduplicated &&
      (await recoverOrphanedTurnConflict({ accepted, userId, sessionId, parentSessionId }))
    ) {
      accepted = await commitTurnLifecycle(actionEvent);
    }
    if (!accepted?.applied && !accepted?.deduplicated) {
      const error = new Error(accepted?.reason || "action_rejected");
      error.errorCode = accepted?.reason || "action_rejected";
      error.currentVersion = accepted?.currentVersion;
      if (accepted?.reason === SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT) {
        error.statusCode = 409;
      }
      throw error;
    }
    pendingLifecycleCommit = null;
    latestAuthorityTurn = accepted.turn || null;
    void recordServiceAgentTransportDebug({
      sessionLogConfig,
      event: "service.agentTransport.commandConsumed",
      command,
      userId,
      data: {
        accepted: true,
        consumed: true,
        transport: "websocket",
        lifecycleEventType: TURN_EVENT.ACTION_ACCEPTED,
        lifecycleRevision: Number(accepted?.turn?.revision || accepted?.currentRevision || 0),
      },
    });
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
        dialogProcessId: String(dialogProcessId || "").trim(),
        turnScopeId: String(
          normalizedRunConfig?.turnScopeId || state.currentTurnScopeId || "",
        ).trim(),
        data: {
          requestedSelectedPlugins: command.preferences.selectedPlugins,
          normalizedSelectedPlugins: normalizedRunConfig?.selectedPlugins,
          normalizedPlugins: summarizePluginConfig(normalizedRunConfig?.plugins),
          normalizedThinkingStartedAt: String(normalizedRunConfig?.thinkingStartedAt || "").trim(),
        },
      });
    }
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
      commandId,
      commandType: command.commandType,
      userId: String(userId || "").trim(),
      runOwnerId: canonicalRunOwnerId,
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(parentSessionId || "").trim(),
      parentDialogProcessId: String(parentDialogProcessId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      turnScopeId: String(
        normalizedRunConfig?.turnScopeId || state.currentTurnScopeId || "",
      ).trim(),
    };
    const runMeta = state.currentRunMeta;
    const runHandle = registerActiveRun({
      userId: state.currentRunMeta.runOwnerId,
      sessionId: state.currentRunMeta.sessionId,
      dialogProcessId: state.currentRunMeta.dialogProcessId,
      turnScopeId: state.currentRunMeta.turnScopeId,
      abortController: state.currentAbortController,
      stopRequested: false,
      stopPayload: null,
    });
    state.currentRunHandle = runHandle;
    state.currentRunTransportBinding = attachRunTransport(runHandle, sendEvent, {
      onDiagnostic: recordRunTransportDiagnostic(runMeta),
    });
    onRunBound?.(runHandle);
    if (
      state.stopRequested &&
      state.currentAbortController &&
      !state.currentAbortController.signal?.aborted
    ) {
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
    const textStreamingEnabled = await resolveEffectiveStreamingEnabled({
      bot: activeBot,
      userId,
      runConfig: normalizedRunConfig,
    });
    let processingStartedPromise = null;
    const eventListener = createRunEventListener({
      sendEvent: (...args) => publishRunEvent(runHandle, ...args),
      sessionId,
      registerActiveRun,
      getCurrentRunMeta: () => runMeta,
      getCurrentRunHandle: () => runHandle,
      getCurrentTurnScopeId: () => runMeta.turnScopeId,
      onEventReceived: (eventData = {}) => {
        const eventType = String(eventData.eventType || eventData.eventName || "").trim();
        if (eventType === "agent_transport_parameters_consumed") {
          void recordServiceAgentTransportDebug({
            sessionLogConfig,
            event: "agent.agentTransport.parametersConsumed",
            command,
            userId,
            data: {
              consumed: true,
              transport: "websocket",
              consumer: "agent",
              consumption: eventData.agentTransportConsumption || {},
            },
          });
          return;
        }
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
            dialogProcessId:
              eventData.dialogProcessId || state.currentRunMeta?.dialogProcessId || "",
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
        )
          return;
        void recordServiceWebSocketLifecycle({
          sessionLogConfig,
          category: "debug",
          level: "debug",
          debugType: "timeline-pipeline",
          event:
            eventType === "timeline_checkpoint_persisted"
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
      onCommittedTurnLifecycle: async (committed = {}, context = {}) => {
        const recordDispatchFailure = (reason = "", delivered = 0) => {
          void recordServiceWebSocketLifecycle({
            sessionLogConfig,
            event: "service.authorityOutbox.dispatchFailed",
            userId,
            sessionId,
            dialogProcessId: state.currentRunMeta?.dialogProcessId || "",
            turnScopeId: committed.turnScopeId || "",
            data: {
              childSessionId: committed.sessionId || "",
              parentSessionId: committed.parentSessionId || parentSessionId,
              persistenceScopeId: context.persistenceScope?.scopeId || "",
              lifecycleEventType: committed.eventType || "",
              reason,
              delivered: Number(delivered || 0),
            },
          });
        };
        try {
          const dispatch = await dispatchAuthorityEvents?.({
            userId: committed.userId || userId,
            sessionId: committed.sessionId,
            parentSessionId: committed.parentSessionId || parentSessionId,
            persistenceScope: context.persistenceScope,
          });
          if (dispatch?.dispatched !== true) {
            recordDispatchFailure(
              dispatch?.reason || "authority_dispatcher_unavailable",
              dispatch?.delivered,
            );
          }
          return dispatch;
        } catch (error) {
          const reason = error?.message || "authority_dispatch_failed";
          recordDispatchFailure(reason);
          return { dispatched: false, reason, delivered: 0 };
        }
      },
      onAuthorityEventCommitted: async (envelope = {}, context = {}) => {
        const dispatch = await dispatchAuthorityEvents?.({
          userId,
          sessionId: envelope.identity.sessionId,
          parentSessionId,
          persistenceScope: context.persistenceScope,
        }, (...args) => publishRunEvent(runHandle, ...args));
        if (dispatch?.dispatched !== true) {
          throw new Error(dispatch?.reason || "authority_event_dispatch_failed");
        }
        return dispatch;
      },
      onRootRunning: (lifecycleData) => {
        if (processingStartedPromise) return processingStartedPromise;
        processingStartedPromise = commitTurnLifecycle({
          userId,
          sessionId,
          parentSessionId,
          turnScopeId: state.currentTurnScopeId,
          dialogProcessId:
            lifecycleData?.dialogProcessId ||
            state.currentRunMeta?.dialogProcessId ||
            dialogProcessId,
          commandId: createTurnLifecycleCommandId({
            commandId,
            eventType: TURN_EVENT.PROCESSING_STARTED,
            phase: TURN_PHASE.PROCESSING,
          }),
          causationId: commandId,
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
            const code = String(started?.reason || "processing_start_failed").trim();
            throw Object.assign(new Error(code), { code });
          }
          latestAuthorityTurn = started.turn || latestAuthorityTurn;
          state.currentLifecyclePhase = TURN_PHASE.PROCESSING;
          return started;
        });
        pendingLifecycleCommit = processingStartedPromise;
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

    const result = await agentApplication.run({
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
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

    if (
      isUserStopRunAbort({
        stopRequested: state.stopRequested,
        abortSignal: state.currentAbortSignal,
      })
    ) {
      await finalizeUserStopped(buildRunStateSnapshot(), { result });
      return;
    }

    const processed = await commitTurnLifecycle({
      userId,
      sessionId: result?.sessionId || sessionId,
      parentSessionId,
      turnScopeId: state.currentTurnScopeId,
      dialogProcessId:
        result?.dialogProcessId || state.currentRunMeta?.dialogProcessId || dialogProcessId,
      commandId: createTurnLifecycleCommandId({
        commandId,
        eventType: TURN_EVENT.PROCESSING_COMPLETED,
        phase: TURN_PHASE.COMPLETION,
      }),
      causationId: commandId,
      eventType: TURN_EVENT.PROCESSING_COMPLETED,
      phase: TURN_PHASE.COMPLETION,
    });
    if (!processed?.applied && !processed?.deduplicated)
      throw new Error(processed?.reason || "processing_completion_failed");
    state.currentLifecyclePhase = TURN_PHASE.COMPLETION;

    await finalizeCompleted(buildRunStateSnapshot(), { result, commandId });
  };
  return { handleRun, commitCurrentFailure };
}
