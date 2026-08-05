/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../model/chatConstants.js";
import { getMessageDialogProcessId, getMessageRole, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { shouldProjectMainSessionEvent } from "../engine/sendFlow.js";
import { dispatchTurnEnvelope, TURN_PROJECTION_SOURCE } from "../engine/turnProjectionStore.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { isTurnRuntimeDeleted, resolveSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";
import {
  logStateMachineDebug,
  summarizeStateMachineTurn,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";
import { createExecutionQueryCommand } from "@noobot/agent-transport-protocol";

export function createReconnectCoordinator({
  activeSession, turnRuntimeRegistry, userId, chatWebSocketClient,
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
      logThinkingReplayDebug("frontend.messageEvent.deletedTurnRejected", () => ({
        sessionId,
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      }));
      return true;
    }
    const messages = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
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
      logThinkingReplayDebug("frontend.thinkingReplay.liveProjectionTargetMissing", () => ({
        sessionId: resolveActiveSessionIdentity(),
        dialogProcessId,
        turnScopeId,
        eventType: String(messageEvent.eventType || ""),
      }));
      return false;
    }
    const reduction = dispatchTurnEnvelope({
      targetMessage: botMessage,
      envelope: messageEvent,
      classifyRealtimeLog,
      source: TURN_PROJECTION_SOURCE.RECONNECT_LIVE,
    });
    logThinkingReplayDebug("frontend.messageEvent.reduced", () => ({
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
    }));
    return true;
  }

  async function handleReconnect() {
    let pendingReconnectReplayCount = 0;
    let reconnectReplayQueue = Promise.resolve();
    const reconnectReplayFailures = [];
    const directExecutionRestoreCommandIds = new Set();
    const reconnectSessionId = String(activeSession.value?.sessionId || "").trim();
    if (!reconnectSessionId) return false;
    const knownLifecycleSequence = Number(
      turnRuntimeRegistry.value?.sessions?.[reconnectSessionId]?.authoritativeSequence || 0,
    );
    const knownLifecycleSequenceMap = reconnectSessionId && knownLifecycleSequence > 0
      ? { [reconnectSessionId]: knownLifecycleSequence }
      : {};
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectStarted", () => ({
      sessionId: reconnectSessionId,
      visibleMessageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    }));
    return chatWebSocketClient.reconnect({
      currentSessionId: reconnectSessionId,
      userId: String(userId?.value || userId || ""),
      knownLifecycleSequenceMap,
      onReconnectData: (reconnectPayload) => {
        logThinkingReplayDebug("frontend.thinkingReplay.reconnectPayloadReceived", () => ({
          sessionId: reconnectSessionId,
          protocolEvent: String(reconnectPayload?.event || "reconnect_data"),
          sessionCount: Array.isArray(reconnectPayload?.sessions) ? reconnectPayload.sessions.length : 0,
          dataSequence: reconnectPayload?.data?.sequence ?? reconnectPayload?.data?.seq ?? null,
          dialogProcessId: String(reconnectPayload?.data?.dialogProcessId || ""),
          turnScopeId: String(reconnectPayload?.data?.turnScopeId || ""),
          dataKeys: Object.keys(reconnectPayload?.data || {}).sort(),
        }));
        const packetData = reconnectPayload?.data || {};
        logStateMachineDebug("stateMachine.reconnect.packet.queued", () => ({
          sessionId: String(packetData?.sessionId || reconnectSessionId),
          dialogProcessId: String(packetData?.dialogProcessId || ""),
          turnScopeId: String(packetData?.turnScopeId || ""),
          protocolEvent: String(reconnectPayload?.event || (reconnectPayload?.sessions ? "reconnect_data" : "")),
          commandId: String(packetData?.commandId || ""),
          transportSequence: Number(packetData?.seq || 0),
          activeTurnBefore: summarizeStateMachineTurn(resolveSessionTurnRuntime(
            turnRuntimeRegistry.value,
            String(packetData?.sessionId || reconnectSessionId),
          )),
          snapshot: reconnectPayload?.event === StreamEventEnum.TURN_SNAPSHOT
            ? summarizeTurnLifecycleSnapshot(packetData)
            : null,
          reconnectSessionCount: Array.isArray(reconnectPayload?.sessions)
            ? reconnectPayload.sessions.length
            : 0,
        }));
        const replayPayload = async () => {
          let result;
          if (reconnectPayload?.sessions) {
            result = await reconnectReplay.applyReconnectData(reconnectPayload);
          }
          if (!(reconnectPayload?.event && reconnectPayload?.data)) return result;
          if (projectReconnectedMainSessionEvent(reconnectPayload.event, reconnectPayload.data)) {
            return { applied: true, reason: "main_session_message_projected" };
          }
          if (directExecutionRestoreCommandIds.has(String(reconnectPayload.data?.commandId || "").trim())) {
            return { applied: false, reason: "direct_execution_restore_owned" };
          }
          result = await reconnectReplay.applyReconnectEvent(reconnectPayload.event, reconnectPayload.data);
          return result;
        };
        const replayAndTrace = async () => {
          const packetSessionId = String(packetData?.sessionId || reconnectSessionId);
          const protocolEvent = String(
            reconnectPayload?.event || (reconnectPayload?.sessions ? "reconnect_data" : ""),
          );
          try {
            const result = await replayPayload();
            const activeTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, packetSessionId);
            logStateMachineDebug("stateMachine.reconnect.packet.committed", () => ({
              sessionId: packetSessionId,
              dialogProcessId: String(packetData?.dialogProcessId || activeTurn?.dialogProcessId || ""),
              turnScopeId: String(packetData?.turnScopeId || activeTurn?.turnScopeId || ""),
              protocolEvent,
              commandId: String(packetData?.commandId || ""),
              applied: result?.applied === true,
              reason: result?.reason || "",
              activeTurnAfter: summarizeStateMachineTurn(activeTurn),
            }));
            return result;
          } catch (error) {
            reconnectReplayFailures.push(error);
            const activeTurn = resolveSessionTurnRuntime(turnRuntimeRegistry.value, packetSessionId);
            logStateMachineDebug("stateMachine.reconnect.packet.failed", () => ({
              sessionId: packetSessionId,
              dialogProcessId: String(packetData?.dialogProcessId || activeTurn?.dialogProcessId || ""),
              turnScopeId: String(packetData?.turnScopeId || activeTurn?.turnScopeId || ""),
              protocolEvent,
              commandId: String(packetData?.commandId || ""),
              errorType: String(error?.name || "Error"),
              errorCode: String(error?.code || ""),
              errorMessage: String(error?.message || error || "").slice(0, 240),
              activeTurnAfter: summarizeStateMachineTurn(activeTurn),
            }));
            throw error;
          }
        };
        pendingReconnectReplayCount += 1;
        reconnectReplayQueue = reconnectReplayQueue.then(replayAndTrace, replayAndTrace);
      },
    }).then(async () => {
      await reconnectReplayQueue;
      if (reconnectReplayFailures.length) throw reconnectReplayFailures[0];
      const replayRuntime = resolveSessionTurnRuntime(
        turnRuntimeRegistry.value,
        reconnectSessionId,
        resolveActiveTurnScopeIdentity(),
      );
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectReplayCommitted", () => ({
        sessionId: reconnectSessionId,
        dialogProcessId: String(replayRuntime?.dialogProcessId || ""),
        turnScopeId: String(replayRuntime?.turnScopeId || ""),
        state: String(replayRuntime?.state || ""),
        backendState: String(replayRuntime?.backendState || ""),
        terminal: replayRuntime?.terminal ?? null,
        pendingReplayCount: pendingReconnectReplayCount,
      }));
      logStateMachineDebug("stateMachine.reconnect.replay.complete", () => ({
        sessionId: reconnectSessionId,
        knownLifecycleSequence,
        pendingReplayCount: pendingReconnectReplayCount,
        replayFailureCount: reconnectReplayFailures.length,
        activeTurnAfter: summarizeStateMachineTurn(replayRuntime),
      }));
      if (typeof chatWebSocketClient.requestJson !== "function") return;
      const sessionId = String(activeSession.value?.sessionId || "").trim();
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
        logStateMachineDebug("stateMachine.reconnect.executionQuery.before", () => ({
          sessionId: reconnectSessionId,
          commandType: action,
          commandId,
          executionId: String(payload?.executionId || ""),
          rootExecutionId: String(payload?.rootExecutionId || ""),
        }));
        try {
          const response = await chatWebSocketClient.requestJson(createExecutionQueryCommand({
            commandType: action,
            commandId,
            identity: { sessionId },
            query: payload,
          }), { expectedEvents: [expectedEvent] });
          const result = await reconnectReplay.applyReconnectEvent(response?.event, response?.data || {});
          logStateMachineDebug("stateMachine.reconnect.executionQuery.after", () => ({
            sessionId: reconnectSessionId,
            commandType: action,
            commandId,
            responseEvent: String(response?.event || ""),
            applied: result?.applied === true,
            reason: String(result?.reason || ""),
          }));
          return result;
        } catch (error) {
          logStateMachineDebug("stateMachine.reconnect.executionQuery.failed", () => ({
            sessionId: reconnectSessionId,
            commandType: action,
            commandId,
            executionId: String(payload?.executionId || ""),
            rootExecutionId: String(payload?.rootExecutionId || ""),
            errorType: String(error?.name || "Error"),
            errorCode: String(error?.code || ""),
            errorMessage: String(error?.message || error || "").slice(0, 240),
          }));
          throw error;
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
        logStateMachineDebug("stateMachine.reconnect.executionRestore.complete", () => ({
          sessionId,
          executionId,
          rootExecutionId,
        }));
      } catch (error) {
        logStateMachineDebug("stateMachine.reconnect.executionRestore.failed", () => ({
          sessionId,
          executionId,
          rootExecutionId,
          errorType: String(error?.name || "Error"),
          errorCode: String(error?.code || ""),
          errorMessage: String(error?.message || error || "").slice(0, 240),
        }));
        logSessionSystemEvent("reconnect.execution_restore_failed", {
          executionId,
          rootExecutionId,
          error: String(error?.message || error || ""),
        });
      }
    }).catch((error) => {
      logThinkingReplayDebug("frontend.thinkingReplay.reconnectFailed", () => ({
        sessionId: reconnectSessionId,
        error: String(error?.message || error || ""),
      }));
      logSessionSystemEvent("reconnect.failed", {
        error: String(error?.message || error || ""),
      });
      notify({ type: "warning", message: translate("infra.reconnectFailed") });
    });
  }

  return { handleReconnect };
}
