/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import { getMessageDialogProcessId, getMessageRole, getMessageTurnScopeId } from "../../infra/messageIdentity";
import { shouldProjectMainSessionEvent } from "../chatEngine/sendFlow";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../chatEngine/turnProjectionStore";
import { logThinkingReplayDebug } from "../debug/thinkingReplayDebugLogger";
import { isTurnRuntimeDeleted, resolveSessionTurnRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry";

export function createReconnectCoordinator({
  activeSession, activeSessionId, turnRuntimeRegistry, userId, chatWebSocketClient,
  reconnectReplay, chatList, classifyRealtimeLog, resolveActiveSessionIdentity,
  resolveActiveTurnScopeIdentity, logSessionSystemEvent, notify, translate,
}) {
  function projectReconnectedMainSessionEvent(event, data = {}) {
    if (!shouldProjectMainSessionEvent(event, data)) return false;
    const messageEvent = data.event || {};
    const dialogProcessId = String(
      messageEvent.dialogProcessId || data.dialogProcessId || "",
    ).trim();
    const turnScopeId = String(messageEvent.turnScopeId || data.turnScopeId || "").trim();
    const sessionId = String(messageEvent.sessionId || data.sessionId || resolveActiveSessionIdentity()).trim();
    if (isTurnRuntimeDeleted(turnRuntimeRegistry.value, { sessionId, turnScopeId })) {
      logThinkingReplayDebug("frontend.messageEvent.deletedTurnRejected", {
        sessionId,
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      });
      return true;
    }
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    // A stopped turn and its continuation may deliberately share a
    // dialogProcessId while owning different turnScopeIds. The turn is the
    // authoritative message projection identity; using the dialog first can
    // project continuation events into the stopped assistant message.
    const reversedAssistantMessages = [...messages].reverse().filter(
      (message) => getMessageRole(message) === RoleEnum.ASSISTANT,
    );
    const botMessage = turnScopeId
      ? reversedAssistantMessages.find(
          (message) => getMessageTurnScopeId(message) === turnScopeId,
        )
      : dialogProcessId
        ? reversedAssistantMessages.find(
            (message) => message?.pending === true &&
              getMessageDialogProcessId(message) === dialogProcessId,
          )
        : null;
    if (!botMessage) {
      logThinkingReplayDebug("frontend.thinkingReplay.liveProjectionTargetMissing", {
        sessionId: resolveActiveSessionIdentity(),
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      });
      return false;
    }
    const reduction = dispatchTurnEnvelope({
      targetMessage: botMessage,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    });
    logThinkingReplayDebug("frontend.messageEvent.reduced", {
      source: "reconnect_live",
      sessionId: messageEvent.sessionId || resolveActiveSessionIdentity(),
      dialogProcessId,
      turnScopeId,
      messageId: String(messageEvent.messageId || ""),
      eventId: String(messageEvent.eventId || ""),
      eventType: String(messageEvent.eventType || ""),
      sequence: messageEvent.sequence ?? null,
      result: reduction.result,
      errors: reduction.errors || [],
    });
    return true;
  }

  async function handleReconnect() {
    const pendingReconnectReplays = [];
    let reconnectReplayQueue = Promise.resolve();
    const directExecutionRestoreCommandIds = new Set();
    const trackReconnectReplay = (replayPromise) => {
      pendingReconnectReplays.push(Promise.resolve(replayPromise));
    };
    const reconnectSessionId = String(activeSession.value?.backendSessionId || activeSessionId.value || "");
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectStarted", {
      sessionId: reconnectSessionId,
      visibleMessageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    });
    return chatWebSocketClient.reconnect({
      currentSessionId: reconnectSessionId,
      userId: String(userId?.value || userId || ""),
      onReconnectData: (reconnectPayload) => {
        logThinkingReplayDebug("frontend.thinkingReplay.reconnectPayloadReceived", {
          sessionId: reconnectSessionId,
          protocolEvent: String(reconnectPayload?.event || "reconnect_data"),
          sessionCount: Array.isArray(reconnectPayload?.sessions) ? reconnectPayload.sessions.length : 0,
          dataSequence: reconnectPayload?.data?.sequence ?? reconnectPayload?.data?.seq ?? null,
          dialogProcessId: String(reconnectPayload?.data?.dialogProcessId || ""),
          turnScopeId: String(reconnectPayload?.data?.turnScopeId || ""),
          dataKeys: Object.keys(reconnectPayload?.data || {}).sort(),
        });
        const replayPayload = async () => {
          if (reconnectPayload?.sessions) {
            await reconnectReplay.applyReconnectData(reconnectPayload);
          }
          if (!(reconnectPayload?.event && reconnectPayload?.data)) return;
          // After reconnect_complete this socket remains the live transport.
          // Authoritative main-session events must update the restored message
          // just like events received by the original send stream.
          if (projectReconnectedMainSessionEvent(reconnectPayload.event, reconnectPayload.data)) {
            return;
          }
          if (directExecutionRestoreCommandIds.has(String(reconnectPayload.data?.commandId || "").trim())) {
            return;
          }
          await reconnectReplay.applyReconnectEvent(reconnectPayload.event, reconnectPayload.data);
        };
        // WebSocket callbacks are synchronous but replay/hydration is not. Keep
        // protocol arrival order across separate callback invocations so a
        // trailing channel_state cannot race the DONE snapshot that owns its
        // Session+Turn identity.
        reconnectReplayQueue = reconnectReplayQueue.then(replayPayload, replayPayload);
        trackReconnectReplay(reconnectReplayQueue);
      },
    }).then(async () => {
      await Promise.all(pendingReconnectReplays);
      const replayRuntime = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        reconnectSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectReplayCommitted", {
        sessionId: reconnectSessionId,
        dialogProcessId: String(replayRuntime?.dialogProcessId || ""),
        turnScopeId: String(replayRuntime?.turnScopeId || ""),
        state: String(replayRuntime?.state || ""),
        backendState: String(replayRuntime?.backendState || ""),
        terminal: replayRuntime?.terminal ?? null,
        pendingReplayCount: pendingReconnectReplays.length,
      });
      if (typeof chatWebSocketClient.requestJson !== "function") return;
      const sessionId = String(activeSession.value?.backendSessionId || activeSessionId.value || "").trim();
      const currentTurn = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        sessionId,
        resolveActiveTurnScopeIdentity(),
      );
      const executionId = String(
        turnRuntimeRegistry.value?.executionIdByTurnScopeId?.[
          `${sessionId}::${currentTurn?.turnScopeId || ""}`
        ] ||
        currentTurn?.executionId ||
        "",
      ).trim();
      if (!executionId) return;
      const execution = turnRuntimeRegistry.value?.executions?.[executionId] || {};
      const rootExecutionId = String(execution?.rootExecutionId || executionId).trim();
      const requestExecution = async (action, payload, expectedEvent) => {
        const commandId = `reconnect:${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        directExecutionRestoreCommandIds.add(commandId);
        try {
          const response = await chatWebSocketClient.requestJson({
            action,
            commandId,
            userId: String(userId?.value || userId || "").trim(),
            ...payload,
          }, { expectedEvents: [expectedEvent] });
          await reconnectReplay.applyReconnectEvent(response?.event, response?.data || {});
        } finally {
          directExecutionRestoreCommandIds.delete(commandId);
        }
      };
      try {
        await requestExecution("execution.tree.get", { rootExecutionId }, StreamEventEnum.EXECUTION_TREE);
        await requestExecution("execution.snapshot.get", { executionId }, StreamEventEnum.EXECUTION_SNAPSHOT);
        if (typeof chatList.fetchSessionFullDetail === "function") {
          await chatList.fetchSessionFullDetail(sessionId);
        }
      } catch (error) {
        logSessionSystemEvent("reconnect.execution_restore_failed", {
          executionId,
          rootExecutionId,
          error: String(error?.message || error || ""),
        });
      }
    }).catch((error) => {
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectFailed", {
        sessionId: reconnectSessionId,
        error: String(error?.message || error || ""),
      });
      logSessionSystemEvent("reconnect.failed", {
        error: String(error?.message || error || ""),
      });
      notify({ type: "warning", message: translate("infra.reconnectFailed") });
    });
  }

  return { handleReconnect };
}
