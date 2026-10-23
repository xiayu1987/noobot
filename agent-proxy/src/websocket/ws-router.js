/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { UPSTREAM_CLOSE_REASON } from "../shared/constants.js";
import {
  writeAgentProxyInvalidJsonPayloadEvent,
  writeAgentProxyWebSocketLifecycleEvent,
  writeAgentProxyRouteLifecycleEvent,
} from "../runtime-events/ws-runtime-events.js";
import { writeAgentProxyRouteDebugEvent } from "../runtime-events/route-debug-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../runtime-events/agent-transport-debug-runtime-events.js";
import { PENDING_COMMAND_KIND } from "../channel/command-registry.js";
import { TURN_LIFECYCLE_RECEIPT_ACTION } from "@noobot/session-protocol";
import {
  AGENT_COMMAND,
  AGENT_TRANSPORT_ERROR_CODE,
  AGENT_TRANSPORT_EVENT,
  EXECUTION_QUERY_COMMAND_TYPES,
  RECONNECT_CONTROL_ACTION,
  createAgentCommandRejection,
  isAgentTransportProtocolError,
  parseAgentCommand,
  parseReconnectControl,
} from "@noobot/agent-transport-protocol";
import { localizeAgentProxyError } from "noobot-i18n/agent-proxy";
import { text } from "@noobot/shared/value";

function resolveRawMessageInfo(rawData) {
  const inputText = String(rawData || "");
  return {
    rawDataType: Buffer.isBuffer(rawData) ? "buffer" : typeof rawData,
    rawDataLength: inputText.length,
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
      this.channelManager.sendSocketError(socket, {
        code: AGENT_TRANSPORT_ERROR_CODE.ROUTE_FAILED,
        identity: {},
      });
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

  handle(socket) {
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
        this.channelManager.sendSocketError(socket, {
          code: AGENT_TRANSPORT_ERROR_CODE.INVALID_JSON_PAYLOAD,
          identity: {},
        });
        return;
      }

      try {
        const action = text(payload?.action).toLowerCase();
        void writeAgentProxyRouteLifecycleEvent({
          event: action ? "agentProxy.route.controlReceived" : "agentProxy.route.commandReceived",
          socket,
          data: {
            action,
            commandType: text(payload?.commandType).toLowerCase(),
            hasSessionId: Boolean(text(payload?.identity?.sessionId)),
            hasChannelKey: Boolean(text(payload?.channelKey)),
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
          this.channelManager.sendSocketError(socket, {
            code: AGENT_TRANSPORT_ERROR_CODE.UNSUPPORTED_ACTION,
            params: { action },
            identity: {},
          });
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
        this._routeAgentCommand(socket, command);
      } catch (error) {
        if (!text(payload?.action)) {
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
              errorCode: String(error?.code || ""),
              validationErrors: Array.isArray(error?.errors) ? error.errors.slice(0, 20) : [],
            },
          });
        }
        if (!parsedCommand && isAgentTransportProtocolError(error)) {
          if (error.command) {
            this._sendCommandFailure(socket, error.command, error);
          } else {
            this.channelManager.sendSocketError(socket, {
              code: AGENT_TRANSPORT_ERROR_CODE.INVALID_AGENT_COMMAND,
              identity: {},
            });
          }
          try {
            socket.close(1008, "invalid_agent_command");
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
          channel: result.receipt.channel,
          data: {
            eventId: result.receipt.eventId,
            eventType: result.receipt.eventType,
            lifecycleSequence: result.receipt.lifecycleSequence,
            transportSequence: result.receipt.transportSequence,
            attempts: result.receipt.attempts,
          },
        });
        return;
      }
      void writeAgentProxyRouteLifecycleEvent({
        event: "agentProxy.route.lifecycleReceipt.rejected",
        socket,
        data: {
          eventIdPresent: Boolean(text(payload?.eventId)),
          reason: result.reason,
        },
      });
    },

    [RECONNECT_CONTROL_ACTION](socket, payload) {
      let control;
      try {
        control = parseReconnectControl(payload);
      } catch (error) {
        this._rejectReconnect(socket, error, "");
        return;
      }
      void this.channelManager.handleReconnect(socket, control).catch((error) => {
        this._rejectReconnect(socket, error, control.identity.sessionId);
      });
    },
  };

  _rejectReconnect(socket, error, sessionId) {
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.reconnect.failed",
      socket,
      data: {
        errorType: String(error?.name || "Error"),
        errorCode: String(error?.code || ""),
        errorMessage: String(error?.message || "reconnect failed").slice(0, 300),
      },
    });
    this.channelManager.sendSocketError(socket, {
      code: AGENT_TRANSPORT_ERROR_CODE.RECONNECT_FAILED,
      identity: { sessionId },
    });
  }

  _routeAgentCommand(socket, command) {
    const { commandType } = command;
    if (commandType === AGENT_COMMAND.SEND || commandType === AGENT_COMMAND.RESEND) {
      this.channelManager.startOrJoinChannel({ socket, payload: command });
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
    if (
      commandType === AGENT_COMMAND.STOP ||
      commandType === AGENT_COMMAND.INTERJECT ||
      commandType === AGENT_COMMAND.INTERACTION_RESPONSE
    ) {
      this._forwardScopedCommand(socket, command);
      return;
    }
    this.channelManager.sendSocketError(socket, {
      code: AGENT_TRANSPORT_ERROR_CODE.UNSUPPORTED_ACTION,
      params: { action: commandType },
      identity: command.identity,
    });
  }

  _commandError(socket, code, params) {
    return { code, message: localizeAgentProxyError(code, socket.__agentProxyLocale, params) };
  }

  _sendCommandFailure(socket, command, error) {
    this.channelManager.sendSocketEvent(socket, {
      event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
      data: createAgentCommandRejection({
        command,
        error,
        occurredAt: new Date().toISOString(),
      }),
    });
  }

  _forwardScopedCommand(socket, command) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, command);
    if (!targetChannel) {
      this.channelManager.sendSocketError(socket, {
        code: AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE,
        identity: command.identity,
      });
      return;
    }
    if (!this.channelManager.hasChannelPermission(targetChannel, socket)) {
      this.channelManager.sendSocketError(socket, {
        code: AGENT_TRANSPORT_ERROR_CODE.PERMISSION_DENIED,
        params: { action: command.commandType },
        identity: command.identity,
      });
      return;
    }
    if (this.channelManager.forwardToUpstream(targetChannel, command)) return;
    this.channelManager.sendSocketError(socket, {
      code: AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE,
      identity: command.identity,
    });
  }

  _forwardExecutionQuery(socket, payload, commandType) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    const { commandId } = payload;
    if (!targetChannel) {
      this._sendCommandFailure(
        socket,
        payload,
        this._commandError(socket, AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE),
      );
      return;
    }
    if (!this.channelManager.hasChannelPermission(targetChannel, socket)) {
      this._sendCommandFailure(
        socket,
        payload,
        this._commandError(socket, AGENT_TRANSPORT_ERROR_CODE.PERMISSION_DENIED, {
          action: commandType,
        }),
      );
      return;
    }
    const pending = { channelKey: targetChannel.key, kind: PENDING_COMMAND_KIND.EXECUTION_QUERY };
    this.channelManager.commandRegistry.register(commandId, {
      ...pending,
      socket,
      settle: (envelope) => this.channelManager.sendSocketEvent(socket, envelope),
    });
    if (this.channelManager.forwardToUpstream(targetChannel, payload)) return;
    this.channelManager.commandRegistry.take(commandId, pending, "forward_failed");
    this._sendCommandFailure(
      socket,
      payload,
      this._commandError(socket, AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE),
    );
  }

  _forwardRunAction(socket, payload, action) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    if (!targetChannel) {
      this.channelManager.startOrJoinChannel({ socket, payload });
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.recreated",
        payload,
        socket,
        data: { action, reason: "target_channel_not_found" },
      });
      return;
    }
    if (!this.channelManager.hasChannelPermission(targetChannel, socket)) {
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.permissionDenied",
        payload,
        socket,
        channel: targetChannel,
        data: { action, reason: "permission_denied" },
      });
      this.channelManager.sendSocketError(socket, {
        code: AGENT_TRANSPORT_ERROR_CODE.PERMISSION_DENIED,
        params: { action },
        identity: payload.identity,
      });
      return;
    }
    const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forwardRun.forwardResult",
      payload,
      socket,
      channel: targetChannel,
      data: { action, forwarded },
    });
    if (forwarded) return;

    if (action === AGENT_COMMAND.CONTINUE) {
      this._restartUpstreamRunAction(socket, targetChannel, payload);
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.forwardRun.restartResult",
        payload,
        socket,
        channel: targetChannel,
        data: { action },
      });
      return;
    }

    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forwardRun.unavailable",
      payload,
      socket,
      channel: targetChannel,
      data: { action, reason: "forward_and_restart_failed" },
    });
    this.channelManager.sendSocketError(socket, {
      code: AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_UNAVAILABLE,
      identity: payload.identity,
    });
  }

  _restartUpstreamRunAction(socket, targetChannel, payload) {
    targetChannel.startPayload = { ...payload };
    targetChannel.startFingerprint = "";
    this.channelManager.resetChannelRun(targetChannel);
    this.channelManager.closeUpstreamChannel(targetChannel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
    this.channelManager.connectUpstreamChannel(
      targetChannel,
      socket.__agentProxyApiKey,
      socket.__agentProxyLocale,
      { initialCommands: [targetChannel.startPayload], purpose: "run" },
    );
  }
}
