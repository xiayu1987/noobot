/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../shared/config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  UPSTREAM_CLOSE_REASON,
  WS_ACTION,
} from "../shared/constants.js";
import {
  writeAgentProxyInvalidJsonPayloadEvent,
  writeAgentProxyWebSocketLifecycleEvent,
  writeAgentProxyRouteLifecycleEvent,
} from "../runtime-events/ws-runtime-events.js";
import { writeAgentProxyRouteDebugEvent } from "../runtime-events/route-debug-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../runtime-events/agent-transport-debug-runtime-events.js";
import { ensureConnectionId } from "../shared/utils.js";
import { TURN_LIFECYCLE_RECEIPT_ACTION } from "@noobot/session-protocol";
import {
  AGENT_COMMAND,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_ERROR_CODE,
  AGENT_TRANSPORT_EVENT,
  EXECUTION_QUERY_COMMAND_TYPES,
  RUN_COMMAND_TYPES,
  createAgentCommandReceipt,
  parseAgentCommand,
} from "@noobot/agent-transport-protocol";

function resolveRawMessageInfo(rawData) {
  const text = String(rawData || "");
  return {
    rawDataType: Buffer.isBuffer(rawData) ? "buffer" : typeof rawData,
    rawDataLength: text.length,
  };
}

export class WsRouter {
  constructor(channelManager) {
    this.channelManager = channelManager;
  }

  _handleRouteFailedSocket(socket, error) {
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.unhandledFailure",
      socket,
      data: {
        errorType: String(error?.name || "Error"),
        errorCode: String(error?.code || ""),
        errorMessage: String(error?.message || "route failed").slice(0, 300),
      },
    });
    try {
      this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.ROUTE_FAILED);
    } catch (sendError) {
      console.warn("[agent-proxy] route failure response failed", sendError);
    }
    try {
      socket.close?.(1011, "route_failed");
    } catch {
      try {
        socket.terminate?.();
      } catch (terminateError) {
        console.warn("[agent-proxy] route failure socket terminate failed", terminateError);
      }
    }
  }

  handle(socket, connectionApiKey, connectionLocale) {
    ensureConnectionId(socket);
    void writeAgentProxyWebSocketLifecycleEvent({
      event: "agentProxy.ws.connectionOpened",
      socket,
    });
    socket.on("close", (code, reason) => {
      void writeAgentProxyWebSocketLifecycleEvent({
        event: "agentProxy.ws.connectionClosed",
        socket,
        data: { code: Number(code || 0), reasonLength: String(reason || "").length },
      });
    });
    socket.on("error", (error) => {
      void writeAgentProxyWebSocketLifecycleEvent({
        event: "agentProxy.ws.connectionError",
        socket,
        data: { error: error?.message || String(error || "unknown") },
      });
    });
    socket.on("message", (rawData) => {
      void writeAgentProxyWebSocketLifecycleEvent({
        event: "agentProxy.ws.messageReceived",
        socket,
        data: { ...resolveRawMessageInfo(rawData) },
      });
      let payload = {};
      let parsedCommand = null;
      try {
        payload = JSON.parse(String(rawData || "{}"));
      } catch {
        void writeAgentTransportDebugEvent({
          event: "agentProxy.agentTransport.commandRejected",
          command: rawData,
          socket,
          data: {
            accepted: false,
            transport: "websocket",
            errorCode: "INVALID_JSON",
            validationErrors: ["invalid_json"],
            ...resolveRawMessageInfo(rawData),
          },
        });
        void writeAgentProxyInvalidJsonPayloadEvent({ rawData });
        this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.INVALID_JSON_PAYLOAD);
        return;
      }

      try {
        const action = String(payload?.action || "")
          .trim()
          .toLowerCase();
        void writeAgentProxyRouteLifecycleEvent({
          event: action ? "agentProxy.route.controlReceived" : "agentProxy.route.commandReceived",
          socket,
          data: {
            action,
            commandType: String(payload?.commandType || "")
              .trim()
              .toLowerCase(),
            hasSessionId: Boolean(
              String(payload?.identity?.sessionId || payload?.sessionId || "").trim(),
            ),
            hasChannelKey: Boolean(String(payload?.channelKey || "").trim()),
          },
        });
        if (action) {
          const handler = this._controlHandlers[action];
          if (handler) {
            handler.call(this, socket, payload);
            return;
          }
          void writeAgentProxyRouteLifecycleEvent({
            event: "agentProxy.route.unsupportedAction",
            socket,
            data: { action },
          });
          this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UNSUPPORTED_ACTION(action));
          return;
        }
        const command = parseAgentCommand(payload);
        parsedCommand = command;
        void writeAgentTransportDebugEvent({
          event: "agentProxy.agentTransport.commandReceived",
          command,
          socket,
          data: { accepted: true, transport: "websocket" },
        });
        this._routeAgentCommand(socket, command, { connectionApiKey, connectionLocale });
      } catch (error) {
        if (!String(payload?.action || "").trim()) {
          void writeAgentTransportDebugEvent({
            event: parsedCommand
              ? "agentProxy.agentTransport.commandDispatchFailed"
              : "agentProxy.agentTransport.commandRejected",
            command: parsedCommand || payload,
            socket,
            data: {
              accepted: Boolean(parsedCommand),
              dispatched: false,
              transport: "websocket",
              errorType: String(error?.name || "Error"),
              errorCode: String(error?.errorCode || error?.code || ""),
              validationErrors: Array.isArray(error?.errors) ? error.errors.slice(0, 20) : [],
            },
          });
        }
        if (
          !parsedCommand &&
          String(error?.errorCode || error?.code || "") === "INVALID_AGENT_COMMAND"
        ) {
          const commandId = String(payload?.commandId || "").trim();
          const commandType = String(payload?.commandType || "").trim();
          const sessionId = String(payload?.identity?.sessionId || "").trim();
          if (commandId && commandType && sessionId) {
            this._sendCommandFailure(socket, payload, error);
          } else {
            this.channelManager.sendSocketError(
              socket,
              String(error?.message || "invalid_agent_command"),
            );
          }
          try {
            socket.close?.(1008, "invalid_agent_command");
          } catch (closeError) {
            console.warn("[agent-proxy] invalid command socket close failed", closeError);
          }
          return;
        }
        this._handleRouteFailedSocket(socket, error);
      }
    });
  }

  _controlHandlers = {
    [TURN_LIFECYCLE_RECEIPT_ACTION](socket, payload) {
      const result = this.channelManager.acknowledgeTurnLifecycleDelivery(socket, payload);
      if (result.acknowledged) {
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.lifecycleReceipt.accepted",
          socket,
          channel: result.receipt?.channel,
          payload,
          data: {
            eventId: result.receipt?.eventId,
            eventType: result.receipt?.eventType,
            lifecycleSequence: result.receipt?.lifecycleSequence,
            transportSequence: result.receipt?.transportSequence,
            attempts: result.receipt?.attempts,
          },
        });
        return;
      }
      void writeAgentProxyRouteLifecycleEvent({
        event: "agentProxy.route.lifecycleReceipt.rejected",
        socket,
        data: {
          eventIdPresent: Boolean(String(payload?.eventId || "").trim()),
          reason: result.reason,
        },
      });
    },

    [WS_ACTION.JOIN](socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_JOIN);
        return;
      }
      if (
        !this.channelManager.hasChannelPermission(
          targetChannel,
          socket.__agentProxyApiKey,
          String(socket?.__agentProxyUserId || "").trim(),
        )
      ) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(WS_ACTION.JOIN),
        );
        return;
      }
      this.channelManager.attachSubscriber(targetChannel, socket);
      if (config.replayOnReconnect) {
        const sequenceByChannel = socket.__agentProxyLastSequenceByChannel || {};
        this.channelManager.replayChannelEvents(
          targetChannel,
          socket,
          Number(sequenceByChannel[targetChannel.key] || 0),
        );
      } else {
        this.channelManager.syncSocketToChannelTail(targetChannel, socket);
      }
    },

    [WS_ACTION.RECONNECT](socket, payload) {
      void this.channelManager.handleReconnect(socket, payload).catch((error) => {
        void writeAgentProxyRouteLifecycleEvent({
          event: "agentProxy.route.reconnect.failed",
          socket,
          data: {
            errorType: String(error?.name || "Error"),
            errorCode: String(error?.code || ""),
            errorMessage: String(error?.message || "reconnect failed").slice(0, 300),
          },
        });
        this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.RECONNECT_FAILED, {
          code: AGENT_TRANSPORT_ERROR_CODE.RECONNECT_FAILED,
          identity: { sessionId: String(payload?.currentSessionId || "").trim() },
        });
      });
    },
  };

  _routeAgentCommand(socket, command, { connectionApiKey, connectionLocale } = {}) {
    const { commandType } = command;
    if (commandType === AGENT_COMMAND.SEND || commandType === AGENT_COMMAND.RESEND) {
      this.channelManager.startOrJoinChannel({
        socket,
        payload: command,
        connectionApiKey,
        connectionLocale,
      });
      return;
    }
    if (commandType === AGENT_COMMAND.CONTINUE) {
      this._forwardRunAction(socket, command, commandType);
      return;
    }
    if (EXECUTION_QUERY_COMMAND_TYPES.includes(commandType)) {
      this._forwardExecutionQuery(socket, command, commandType);
      return;
    }
    if (commandType === AGENT_COMMAND.TURN_SNAPSHOT_GET || commandType === AGENT_COMMAND.FINALIZE) {
      this._forwardSnapshotCommand(socket, command);
      return;
    }
    if (commandType === AGENT_COMMAND.STOP || commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
      this._forwardScopedCommand(socket, command);
      return;
    }
    if (RUN_COMMAND_TYPES.includes(commandType)) {
      this.channelManager.startOrJoinChannel({
        socket,
        payload: command,
        connectionApiKey,
        connectionLocale,
      });
      return;
    }
    this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UNSUPPORTED_ACTION(commandType));
  }

  _sendCommandFailure(socket, command, error) {
    const receipt = createAgentCommandReceipt({
      commandId: command.commandId,
      commandType: command.commandType,
      outcome: AGENT_COMMAND_RECEIPT_OUTCOME.FAILED,
      identity: command.identity,
      error: {
        code: String(error?.code || error?.errorCode || "COMMAND_FAILED"),
        message: String(error?.message || AGENT_PROXY_ERROR.DEFAULT),
      },
    });
    this.channelManager.sendSocketEvent(socket, {
      event: AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT,
      data: receipt,
    });
  }

  _forwardScopedCommand(socket, command) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, command);
    if (!targetChannel) {
      this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
      return;
    }
    if (
      !this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )
    ) {
      this.channelManager.sendSocketError(
        socket,
        AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(command.commandType),
      );
      return;
    }
    if (this.channelManager.forwardToUpstream(targetChannel, command)) return;
    this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
  }

  _forwardSnapshotCommand(socket, command) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, command);
    if (
      !targetChannel ||
      !this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )
    ) {
      this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
      return;
    }
    targetChannel.pendingSnapshotRequests ||= new Map();
    targetChannel.pendingSnapshotRequests.set(command.commandId, socket);
    if (this.channelManager.forwardToUpstream(targetChannel, command)) return;
    targetChannel.pendingSnapshotRequests.delete(command.commandId);
    this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
  }

  _forwardExecutionQuery(socket, payload, commandType) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    const commandId = String(payload?.commandId || "").trim();
    if (!targetChannel || !commandId) {
      this._sendCommandFailure(socket, payload, {
        code: "UPSTREAM_UNAVAILABLE",
        message: AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE,
      });
      return;
    }
    if (
      !this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )
    ) {
      this._sendCommandFailure(socket, payload, {
        code: "PERMISSION_DENIED",
        message: AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(commandType),
      });
      return;
    }
    targetChannel.pendingExecutionRequests ||= new Map();
    targetChannel.pendingExecutionRequests.set(commandId, socket);
    if (this.channelManager.forwardToUpstream(targetChannel, payload)) return;
    targetChannel.pendingExecutionRequests.delete(commandId);
    this._sendCommandFailure(socket, payload, {
      code: "UPSTREAM_UNAVAILABLE",
      message: AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE,
    });
  }

  _forwardRunAction(socket, payload, action) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    if (!targetChannel) {
      const userId = String(socket?.__agentProxyUserId || "").trim();
      const sessionId = String(payload?.identity?.sessionId || "").trim();
      if (userId && sessionId && typeof this.channelManager?.startOrJoinChannel === "function") {
        this.channelManager.startOrJoinChannel({
          socket,
          payload,
          connectionApiKey: String(socket?.__agentProxyApiKey || "").trim(),
          connectionLocale: String(socket?.__agentProxyLocale || "").trim(),
        });
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.forwardRun.recreated",
          payload,
          socket,
          data: { action, reason: "target_channel_not_found" },
        });
        return;
      }
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.unavailable",
        payload,
        socket,
        data: { action, reason: "target_channel_not_found" },
      });
      this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
      return;
    }
    if (
      !this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )
    ) {
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.permissionDenied",
        payload,
        socket,
        channel: targetChannel,
        data: { action, reason: "permission_denied" },
      });
      this.channelManager.sendSocketError(
        socket,
        AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(action),
      );
      return;
    }
    const upstreamOpen =
      targetChannel?.upstreamSocket?.readyState === this.channelManager?.WebSocket?.OPEN;
    const forwarded = upstreamOpen
      ? this.channelManager.forwardToUpstream(targetChannel, payload)
      : false;
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forwardRun.forwardResult",
      payload,
      socket,
      channel: targetChannel,
      data: { action, forwarded },
    });
    if (forwarded) return;

    if (action === AGENT_COMMAND.CONTINUE) {
      const restarted = this._restartUpstreamRunAction(socket, targetChannel, payload);
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.restartResult",
        payload,
        socket,
        channel: targetChannel,
        data: { action, restarted },
      });
      if (restarted) return;
    }

    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forwardRun.unavailable",
      payload,
      socket,
      channel: targetChannel,
      data: { action, reason: "forward_and_restart_failed" },
    });
    this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
  }

  _restartUpstreamRunAction(socket, targetChannel, payload) {
    if (
      typeof this.channelManager?.connectUpstreamChannel !== "function" ||
      typeof this.channelManager?.closeUpstreamChannel !== "function"
    ) {
      return false;
    }

    targetChannel.startPayload = { ...(payload || {}) };
    targetChannel.startFingerprint = "";
    targetChannel.retention ||= {
      phase: CHANNEL_RETENTION_PHASE.ACTIVE,
      terminalStatus: "",
      cleanupAfterMs: 0,
    };
    targetChannel.activity ||= { phase: CHANNEL_STATUS.IDLE };
    targetChannel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
    targetChannel.retention.terminalStatus = "";
    targetChannel.retention.cleanupAfterMs = 0;
    targetChannel.cleanupAfterMs = 0;
    targetChannel.upstreamClosed = false;
    targetChannel._errorHandled = false;
    targetChannel.activity.phase = CHANNEL_STATUS.IDLE;

    this.channelManager.closeUpstreamChannel(targetChannel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
    this.channelManager.connectUpstreamChannel(
      targetChannel,
      String(socket?.__agentProxyApiKey || targetChannel?.apiKey || "").trim(),
      String(targetChannel?.locale || "").trim(),
    );
    return true;
  }
}
