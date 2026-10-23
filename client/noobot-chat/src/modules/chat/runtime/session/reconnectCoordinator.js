/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "@noobot/shared/secure-identity";
import { StreamEventEnum } from "../../model/chatConstants.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { resolveSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";
import { executionTurnKey } from "../run-state-machine/turnRuntimeRegistryIdentity.js";
import {
  logStateMachineDebug,
  summarizeStateMachineTurn,
  summarizeTurnLifecycleSnapshot,
} from "../../../debug/loggers/stateMachineLogger.js";
import { createExecutionQueryCommand } from "@noobot/agent-transport-protocol";
import { text } from "@noobot/shared/value";

export function createReconnectCoordinator({
  activeSession,
  turnRuntimeRegistry,
  chatWebSocketClient,
  reconnectReplay,
  resolveActiveTurnScopeIdentity,
  logSessionSystemEvent,
  notify,
  translate,
}) {
  async function handleReconnect() {
    let pendingReconnectReplayCount = 0;
    let reconnectReplayQueue = Promise.resolve();
    const reconnectReplayFailures = [];
    const directExecutionRestoreCommandIds = new Set();
    const reconnectSessionId = text(activeSession.value?.sessionId);
    if (!reconnectSessionId) return false;
    const knownLifecycleSequence =
      turnRuntimeRegistry.value?.sessions?.[reconnectSessionId]?.authoritativeSequence;
    const knownLifecycleSequenceMap =
      knownLifecycleSequence > 0 ? { [reconnectSessionId]: knownLifecycleSequence } : {};
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectStarted", () => ({
      sessionId: reconnectSessionId,
      visibleMessageCount: Array.isArray(activeSession.value?.messages)
        ? activeSession.value.messages.length
        : 0,
    }));
    return chatWebSocketClient
      .reconnect({
        identity: {
          sessionId: reconnectSessionId,
          parentSessionId: text(activeSession.value?.parentSessionId),
          parentDialogProcessId: text(activeSession.value?.parentDialogProcessId),
        },
        knownLifecycleSequenceMap,
        onReconnectData: (reconnectPayload) => {
          const protocolEvent = reconnectPayload.event;
          const packetData = reconnectPayload.data;
          const isReconnectData = protocolEvent === StreamEventEnum.RECONNECT_DATA;
          const reconnectSessionCount = isReconnectData ? packetData.sessions.length : 0;
          const packetSessionId = text(packetData?.identity?.sessionId);
          const packetTurnScopeId = text(packetData?.identity?.turnScopeId);
          const packetCommandId = text(packetData?.causality?.commandId);
          logThinkingReplayDebug("frontend.thinkingReplay.reconnectPayloadReceived", () => ({
            sessionId: reconnectSessionId,
            protocolEvent,
            sessionCount: reconnectSessionCount,
            dataSequence: packetData?.ordering?.sequence,
            turnScopeId: packetTurnScopeId,
            dataKeys: Object.keys(packetData || {}).sort(),
          }));
          logStateMachineDebug("stateMachine.reconnect.packet.queued", () => ({
            sessionId: packetSessionId,
            turnScopeId: packetTurnScopeId,
            protocolEvent,
            commandId: packetCommandId,
            activeTurnBefore: summarizeStateMachineTurn(
              resolveSessionTurnRuntime(turnRuntimeRegistry.value, packetSessionId),
            ),
            snapshot:
              reconnectPayload?.event === StreamEventEnum.TURN_SNAPSHOT
                ? summarizeTurnLifecycleSnapshot(packetData)
                : null,
            reconnectSessionCount,
          }));
          const replayPayload = async () => {
            if (isReconnectData) return reconnectReplay.applyReconnectData(packetData);
            if (directExecutionRestoreCommandIds.has(packetCommandId)) {
              return { applied: false, reason: "direct_execution_restore_owned" };
            }
            return reconnectReplay.applyReconnectEvent(protocolEvent, packetData);
          };
          const replayAndTrace = async () => {
            try {
              const result = await replayPayload();
              const activeTurn = resolveSessionTurnRuntime(
                turnRuntimeRegistry.value,
                packetSessionId,
              );
              logStateMachineDebug("stateMachine.reconnect.packet.committed", () => ({
                sessionId: packetSessionId,
                turnScopeId: packetTurnScopeId,
                protocolEvent,
                commandId: packetCommandId,
                applied: result?.applied === true,
                reason: result?.reason || "",
                activeTurnAfter: summarizeStateMachineTurn(activeTurn),
              }));
              return result;
            } catch (error) {
              reconnectReplayFailures.push(error);
              const activeTurn = resolveSessionTurnRuntime(
                turnRuntimeRegistry.value,
                packetSessionId,
              );
              logStateMachineDebug("stateMachine.reconnect.packet.failed", () => ({
                sessionId: packetSessionId,
                turnScopeId: packetTurnScopeId,
                protocolEvent,
                commandId: packetCommandId,
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
      })
      .then(async () => {
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
        const sessionId = text(activeSession.value?.sessionId);
        const currentTurn = resolveSessionTurnRuntime(
          turnRuntimeRegistry.value,
          sessionId,
          resolveActiveTurnScopeIdentity(),
        );
        const executionId = text(
          turnRuntimeRegistry.value?.executionIdByTurnScopeId?.[
            executionTurnKey(sessionId, currentTurn?.turnScopeId)
          ],
        );
        if (!executionId) return;
        const execution = turnRuntimeRegistry.value?.executions?.[executionId] || {};
        const rootExecutionId = String(execution?.rootExecutionId || executionId).trim();
        const requestExecution = async (action, payload, expectedEvent) => {
          const commandId = createSecureId(`reconnect:${action}`);
          directExecutionRestoreCommandIds.add(commandId);
          logStateMachineDebug("stateMachine.reconnect.executionQuery.before", () => ({
            sessionId: reconnectSessionId,
            commandType: action,
            commandId,
            executionId: String(payload?.executionId || ""),
            rootExecutionId: String(payload?.rootExecutionId || ""),
          }));
          try {
            const { event, data } = await chatWebSocketClient.requestJson(
              createExecutionQueryCommand({
                commandType: action,
                commandId,
                identity: { sessionId },
                query: payload,
              }),
              { expectedEvents: [expectedEvent] },
            );
            const result = await reconnectReplay.applyReconnectEvent(event, data);
            logStateMachineDebug("stateMachine.reconnect.executionQuery.after", () => ({
              sessionId: reconnectSessionId,
              commandType: action,
              commandId,
              responseEvent: event,
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
          await requestExecution(
            "execution.tree.get",
            { executionId: "", rootExecutionId },
            StreamEventEnum.EXECUTION_TREE,
          );
          await requestExecution(
            "execution.snapshot.get",
            { executionId, rootExecutionId: "" },
            StreamEventEnum.EXECUTION_SNAPSHOT,
          );
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
      })
      .catch((error) => {
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
