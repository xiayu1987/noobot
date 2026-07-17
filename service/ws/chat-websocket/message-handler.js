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
  consumePendingStop,
  findActiveRun,
  registerActiveRun,
  rememberPendingStop,
  unregisterActiveRun,
} from "./run-registry.js";
import { summarizeDebugAttachments } from "./runtime-events.js";
import {
  isPluginDebugEnabled,
  resolveEffectiveRunTimeoutMs,
  resolveEffectiveStreamingEnabled,
  summarizePluginConfig,
} from "./run-config.js";
import { isAbortLikeError, isSocketCloseRunAbort, isUserStopRunAbort } from "./stop-lifecycle.js";
import { createRunEventListener } from "./run-event-listener.js";
import { resetRunState } from "./connection-state.js";

/**
 * Build the WebSocket `message` handler for a single connection.
 *
 * The handler owns three protocol actions:
 *  - `interaction_response`: resolve a pending user-interaction request.
 *  - `stop` / `resume`-stop: abort the active run or stage a pending stop.
 *  - run / `continue`: orchestrate a full session execution turn.
 *
 * All per-connection mutable run state lives on the shared `state` object so it
 * stays consistent across the message handler, event listener, terminal
 * finalizers and the socket close handler.
 *
 * @returns {(rawMessage: unknown) => Promise<void>}
 */
export function createMessageHandler({
  state,
  authInfo,
  webSocket,
  sendEvent,
  translateText,
  normalizeLocale,
  normalizeRunConfig,
  isForbiddenUserScope,
  resolveBot,
  sessionLogConfig,
  pendingInteractionRequests,
  rejectAllPendingInteractions,
  userInteractionBridge,
  buildRunStateSnapshot,
  finalizeTimeout,
  finalizeUserStopped,
  finalizeCompleted,
  finalizeAborted,
  finalizeGenericError,
}) {
  const handleInteractionResponse = (payload) => {
    const requestId = String(payload?.requestId || "").trim();
    const requestItem = pendingInteractionRequests.get(requestId);
    if (!requestItem) {
      sendEvent("error", { error: translateText("ws.interactionNotFound", state.currentLocale) });
      return;
    }
    pendingInteractionRequests.delete(requestId);
    clearTimeout(requestItem.timer);
    requestItem.resolve(payload?.response ?? {});
  };

  const handleStop = async (payload) => {
    state.stopRequested = true;
    state.currentTurnScopeId =
      String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
      state.currentTurnScopeId;
    rejectAllPendingInteractions(new Error(translateText("ws.dialogStoppedByUser", state.currentLocale)));
    state.currentStopPayload = {
      message: translateText("ws.dialogStoppedByUser", state.currentLocale),
      sessionId:
        String(payload?.sessionId || payload?.partialAssistant?.sessionId || "").trim() ||
        state.currentRunMeta?.sessionId ||
        "",
      dialogProcessId:
        String(payload?.dialogProcessId || "").trim() ||
        String(payload?.partialAssistant?.dialogProcessId || "").trim() ||
        state.currentRunMeta?.dialogProcessId ||
        "",
      turnScopeId:
        String(payload?.turnScopeId || payload?.partialAssistant?.turnScopeId || "").trim() ||
        state.currentTurnScopeId ||
        state.currentRunMeta?.turnScopeId ||
        "",
      partialAssistant: payload?.partialAssistant || {},
    };
    const activeRun = findActiveRun(state.currentStopPayload);
    if (activeRun && activeRun.abortController && !activeRun.abortController.signal?.aborted) {
      activeRun.stopRequested = true;
      activeRun.stopPayload = state.currentStopPayload;
      activeRun.abortController.abort({
        type: "user_stop",
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      });
      sendEvent("channel_state", {
        ...state.currentStopPayload,
        state: "stopping",
        sourceEvent: "stop_requested_registry",
      });
      return;
    }
    if (!state.isRunning || !state.currentAbortController) {
      const stopPayload = state.currentStopPayload;
      const userId = String(authInfo?.userId || payload?.userId || "").trim();
      let turnStatus = null;
      try {
        turnStatus = await resolveBot()?.persistStoppedAssistantMessage?.({
          userId,
          sessionId: stopPayload.sessionId,
          parentSessionId: String(payload?.parentSessionId || "").trim(),
          parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
          partialAssistant: {
            ...(stopPayload.partialAssistant || {}),
            sessionId: stopPayload.sessionId,
            dialogProcessId: stopPayload.dialogProcessId,
            turnScopeId: stopPayload.turnScopeId,
          },
        });
      } catch {
        turnStatus = null;
      }
      if (turnStatus?.status === "user_stopped") {
        sendEvent("channel_state", {
          ...stopPayload,
          state: "stopping",
          sourceEvent: "stop_requested_idle_persisted",
          turnStatus,
        });
        sendEvent("user_stopped", {
          ...stopPayload,
          turnStatus,
        });
        return;
      }
      // A pre-existing terminal status (for example completed) wins. Only keep
      // a pending stop when no authoritative terminal fact could be persisted.
      if (!turnStatus) {
        rememberPendingStop(stopPayload, stopPayload);
      }
      sendEvent("channel_state", {
        ...stopPayload,
        state: turnStatus?.status || "stopping",
        sourceEvent: turnStatus ? "stop_requested_terminal_exists" : "stop_requested_pending",
        turnStatus: turnStatus || undefined,
      });
      return;
    }
    if (state.isRunning && state.currentAbortController) {
      state.currentAbortController.abort({
        type: "user_stop",
        reason: "user stop action",
        stopPayload: state.currentStopPayload,
      });
    }
    sendEvent("channel_state", {
      ...state.currentStopPayload,
      state: "stopping",
      sourceEvent: "stop_requested",
    });
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
      idempotencyKey: String(
        idempotencyKey || config?.idempotencyKey || turnScopeId || config?.turnScopeId || "",
      ).trim(),
      expectedVersion,
    };
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
      sessionId: String(sessionId || "").trim(),
      parentSessionId: String(parentSessionId || "").trim(),
      parentDialogProcessId: String(parentDialogProcessId || "").trim(),
      dialogProcessId: "",
      turnScopeId: String(normalizedRunConfig?.turnScopeId || state.currentTurnScopeId || "").trim(),
    };
    state.currentRunHandle = registerActiveRun({
      userId: state.currentRunMeta.userId,
      sessionId: state.currentRunMeta.sessionId,
      dialogProcessId: state.currentRunMeta.dialogProcessId,
      turnScopeId: state.currentRunMeta.turnScopeId,
      abortController: state.currentAbortController,
      stopRequested: false,
      stopPayload: null,
    });
    const pendingStopPayload = consumePendingStop(state.currentRunMeta);
    if (pendingStopPayload) {
      state.stopRequested = true;
      state.currentStopPayload = {
        ...pendingStopPayload,
        sessionId: pendingStopPayload?.sessionId || state.currentRunMeta.sessionId || "",
        turnScopeId: pendingStopPayload?.turnScopeId || state.currentRunMeta.turnScopeId || "",
      };
    }
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
    const eventListener = createRunEventListener({
      sendEvent,
      sessionId,
      textStreamingEnabled,
      registerActiveRun,
      getCurrentRunMeta: () => state.currentRunMeta,
      getCurrentRunHandle: () => state.currentRunHandle,
      getCurrentTurnScopeId: () => state.currentTurnScopeId,
    });

    const result = await activeBot.runSession({
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

    await finalizeCompleted(buildRunStateSnapshot(), { result });
  };

  return async function onMessage(rawMessage) {
    let runMessageStarted = false;
    try {
      const payload = JSON.parse(String(rawMessage || "{}"));
      const action = String(payload?.action || "").trim().toLowerCase();
      const isContinueAction = action === "continue" || action === "resume";
      if (action === "interaction_response") {
        handleInteractionResponse(payload);
        return;
      }
      if (action === "stop") {
        await handleStop(payload);
        return;
      }
      if (state.isRunning) {
        sendEvent("error", { error: translateText("ws.sessionAlreadyRunning", state.currentLocale) });
        return;
      }
      // The run lifecycle owns a persisted terminal status only after this point.
      runMessageStarted = true;
      await handleRun(payload, { isContinueAction });
    } catch (error) {
      // Request/auth/resume validation errors are protocol failures, not turn
      // execution outcomes. A turn only owns a persisted terminal status after
      // the execution lifecycle has actually started.
      if (!runMessageStarted || !state.currentRunMeta) {
        sendEvent("error", {
          error: error?.message || translateText("ws.unknownError", state.currentLocale),
          status: Number(error?.statusCode || error?.status || 0) || undefined,
          errorCode: String(error?.errorCode || error?.code || "").trim() || undefined,
          currentVersion: error?.currentVersion,
          sessionId: state.currentRunMeta?.sessionId || "",
          turnScopeId: state.currentRunMeta?.turnScopeId || state.currentTurnScopeId || "",
        });
        webSocket.close(1008, "invalid request");
        return;
      }
      if (state.currentAbortSignal?.aborted || isAbortLikeError(error)) {
        if (state.currentRunTimedOut) {
          await finalizeTimeout(buildRunStateSnapshot(), {
            description: error?.message || "run timeout",
            errorObject: error,
          });
        } else if (
          isUserStopRunAbort({ stopRequested: state.stopRequested, abortSignal: state.currentAbortSignal })
        ) {
          await finalizeUserStopped(buildRunStateSnapshot());
        } else if (isSocketCloseRunAbort(state.currentAbortSignal)) {
          // Refreshing, navigating away, or disposing the client closes the
          // transport. It cancels local execution but is not a turn error and
          // must not create an ERROR/run_aborted terminal fact.
          return;
        } else {
          await finalizeAborted(buildRunStateSnapshot(), { error });
        }
        return;
      }
      await finalizeGenericError(buildRunStateSnapshot(), { error });
    } finally {
      if (runMessageStarted) {
        if (state.currentRunHandle) {
          unregisterActiveRun(state.currentRunHandle);
        }
        resetRunState(state);
      }
    }
  };
}
