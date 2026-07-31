/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../shared/config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
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
import { ensureConnectionId } from "../shared/utils.js";
import { EXECUTION_QUERY_COMMAND } from "@noobot/shared/execution-lifecycle-protocol";

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
    socket.on(CHANNEL_EVENT.ERROR, (error) => {
      void writeAgentProxyWebSocketLifecycleEvent({
        event: "agentProxy.ws.connectionError",
        socket,
        data: { error: error?.message || String(error || "unknown") },
      });
    });
    socket.on(CHANNEL_EVENT.MESSAGE, (rawData) => {
      void writeAgentProxyWebSocketLifecycleEvent({
        event: "agentProxy.ws.messageReceived",
        socket,
        data: { ...resolveRawMessageInfo(rawData) },
      });
      let payload = {};
      try {
        payload = JSON.parse(String(rawData || "{}"));
      } catch {
        void writeAgentProxyInvalidJsonPayloadEvent({ rawData });
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.INVALID_JSON_PAYLOAD,
        );
        return;
      }

      try {
        const action = String(payload?.action || "").trim().toLowerCase();
        const commandType = String(payload?.commandType || "").trim().toLowerCase();
        void writeAgentProxyRouteLifecycleEvent({
          event: commandType
            ? "agentProxy.route.commandReceived"
            : action
              ? "agentProxy.route.actionReceived"
              : "agentProxy.route.channelStartReceived",
          socket,
          data: {
            action,
            commandType,
            hasSessionId: Boolean(String(payload?.sessionId || "").trim()),
            hasChannelKey: Boolean(String(payload?.channelKey || "").trim()),
          },
        });
        if (Object.values(EXECUTION_QUERY_COMMAND).includes(commandType)) {
          this._forwardExecutionQuery(socket, payload, commandType);
          return;
        }
        if (!action) {
          this.channelManager.startOrJoinChannel({
            socket,
            payload,
            connectionApiKey,
            connectionLocale,
          });
          return;
        }

        const handler = this._handlers[action];
        if (handler) {
          handler.call(this, socket, payload);
        } else {
          void writeAgentProxyRouteLifecycleEvent({ event: "agentProxy.route.unsupportedAction", socket, data: { action } });
          this.channelManager.sendSocketError(
            socket,
            AGENT_PROXY_ERROR.UNSUPPORTED_ACTION(action),
          );
        }
      } catch (error) {
        void writeAgentProxyRouteLifecycleEvent({
          event: "agentProxy.route.unhandledFailure",
          socket,
          data: {
            errorType: String(error?.name || "Error"),
            errorCode: String(error?.code || ""),
          },
        });
        try { this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.ROUTE_FAILED); } catch {}
        try { socket.close?.(1011, "route_failed"); } catch { try { socket.terminate?.(); } catch {} }
      }
    });
  }


  _handlers = {
    [WS_ACTION.SNAPSHOT_GET](socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
        return;
      }
      if (!this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(WS_ACTION.SNAPSHOT_GET),
        );
        return;
      }
      const commandId = String(payload?.commandId || "").trim();
      if (!commandId) {
        this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.INVALID_JSON_PAYLOAD);
        return;
      }
      targetChannel.pendingSnapshotRequests ||= new Map();
      targetChannel.pendingSnapshotRequests.set(commandId, socket);
      if (this.channelManager.forwardToUpstream(targetChannel, payload)) return;
      targetChannel.pendingSnapshotRequests.delete(commandId);
      this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
    },

    [WS_ACTION.STOP](socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_STOP,
        );
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
          AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(WS_ACTION.STOP),
        );
        return;
      }
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
      if (forwarded) return;
      this.channelManager.sendSocketError(
        socket,
        AGENT_PROXY_ERROR.UPSTREAM_NOT_RUNNING,
      );
    },

    [WS_ACTION.CONTINUE](socket, payload) {
      this._forwardRunAction(socket, payload, WS_ACTION.CONTINUE);
    },

    [WS_ACTION.RESUME](socket, payload) {
      this._forwardRunAction(socket, payload, WS_ACTION.RESUME);
    },

    [WS_ACTION.INTERACTION_RESPONSE](socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_INTERACTION,
        );
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
          AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(
            WS_ACTION.INTERACTION_RESPONSE,
          ),
        );
        return;
      }
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
      if (!forwarded) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE,
        );
      }
    },

    [WS_ACTION.JOIN](socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.CHANNEL_NOT_FOUND_FOR_JOIN,
        );
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
          event: "agentProxy.route.unhandledFailure",
          socket,
          data: {
            errorType: String(error?.name || "Error"),
            errorCode: String(error?.code || ""),
          },
        });
        try { this.channelManager.sendSocketError(socket, AGENT_PROXY_ERROR.ROUTE_FAILED); } catch {}
        try { socket.close?.(1011, "route_failed"); } catch { try { socket.terminate?.(); } catch {} }
      });
    },
  };

  _forwardExecutionQuery(socket, payload, commandType) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    const commandId = String(payload?.commandId || "").trim();
    if (!targetChannel || !commandId) {
      this.channelManager.sendSocketEvent(socket, {
        event: CHANNEL_EVENT.ERROR,
        data: { error: AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE, commandId },
      });
      return;
    }
    if (!this.channelManager.hasChannelPermission(
      targetChannel,
      socket.__agentProxyApiKey,
      String(socket?.__agentProxyUserId || "").trim(),
    )) {
      this.channelManager.sendSocketEvent(socket, {
        event: CHANNEL_EVENT.ERROR,
        data: {
          error: AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(commandType),
          commandId,
        },
      });
      return;
    }
    targetChannel.pendingExecutionRequests ||= new Map();
    targetChannel.pendingExecutionRequests.set(commandId, socket);
    if (this.channelManager.forwardToUpstream(targetChannel, payload)) return;
    targetChannel.pendingExecutionRequests.delete(commandId);
    this.channelManager.sendSocketEvent(socket, {
      event: CHANNEL_EVENT.ERROR,
      data: { error: AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE, commandId },
    });
  }

  _forwardRunAction(socket, payload, action) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    if (!targetChannel) {
      const userId = String(payload?.userId || socket?.__agentProxyUserId || "").trim();
      const sessionId = String(payload?.sessionId || "").trim();
      if (
        userId &&
        sessionId &&
        typeof this.channelManager?.startOrJoinChannel === "function"
      ) {
        this.channelManager.startOrJoinChannel({
          socket,
          payload: { ...(payload || {}), userId, sessionId },
          connectionApiKey: String(socket?.__agentProxyApiKey || "").trim(),
          connectionLocale: String(socket?.__agentProxyLocale || "").trim(),
        });
        void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.recreated", payload, socket, data: { action, reason: "target_channel_not_found" } });
        return;
      }
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.unavailable", payload, socket, data: { action, reason: "target_channel_not_found" } });
      this.channelManager.sendSocketError(
        socket,
        AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE,
      );
      return;
    }
    if (
      !this.channelManager.hasChannelPermission(
        targetChannel,
        socket.__agentProxyApiKey,
        String(socket?.__agentProxyUserId || "").trim(),
      )
    ) {
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.permissionDenied", payload, socket, channel: targetChannel, data: { action, reason: "permission_denied" } });
      this.channelManager.sendSocketError(
        socket,
        AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION(action),
      );
      return;
    }
    const upstreamOpen = targetChannel?.upstreamSocket?.readyState ===
      this.channelManager?.WebSocket?.OPEN;
    const forwarded = upstreamOpen
      ? this.channelManager.forwardToUpstream(targetChannel, payload)
      : false;
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.forwardResult", payload, socket, channel: targetChannel, data: { action, forwarded } });
    if (forwarded) return;

    if (
      action === WS_ACTION.CONTINUE ||
      action === WS_ACTION.RESUME
    ) {
      const restarted = this._restartUpstreamRunAction(socket, targetChannel, payload);
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.restartResult", payload, socket, channel: targetChannel, data: { action, restarted } });
      if (restarted) return;
    }

    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forwardRun.unavailable", payload, socket, channel: targetChannel, data: { action, reason: "forward_and_restart_failed" } });
    this.channelManager.sendSocketError(
      socket,
      AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE,
    );
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
    targetChannel.retention ||= { phase: CHANNEL_RETENTION_PHASE.ACTIVE, terminalStatus: "", cleanupAfterMs: 0 };
    targetChannel.activity ||= { phase: CHANNEL_STATUS.IDLE };
    targetChannel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
    targetChannel.retention.terminalStatus = "";
    targetChannel.retention.cleanupAfterMs = 0;
    targetChannel.cleanupAfterMs = 0;
    targetChannel.upstreamClosed = false;
    targetChannel._errorHandled = false;
    targetChannel.activity.phase = CHANNEL_STATUS.IDLE;

    this.channelManager.closeUpstreamChannel(
      targetChannel,
      1000,
      UPSTREAM_CLOSE_REASON.RESTART,
    );
    this.channelManager.connectUpstreamChannel(
      targetChannel,
      String(socket?.__agentProxyApiKey || targetChannel?.apiKey || "").trim(),
      String(targetChannel?.locale || "").trim(),
    );
    return true;
  }
}
