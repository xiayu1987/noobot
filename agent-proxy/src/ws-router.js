/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
  CHANNEL_STATUS,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  UPSTREAM_CLOSE_REASON,
  WS_ACTION,
} from "./constants.js";
import { writeAgentProxyInvalidJsonPayloadEvent } from "./ws-runtime-events.js";
import { writeAgentProxyRouteDebugEvent } from "./route-debug-runtime-events.js";

export class WsRouter {
  constructor(channelManager) {
    this.channelManager = channelManager;
  }

  handle(socket, connectionApiKey, connectionLocale) {
    socket.on(CHANNEL_EVENT.MESSAGE, (rawData) => {
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

      const action = String(payload?.action || "").trim().toLowerCase();
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
        this.channelManager.sendSocketError(
          socket,
          AGENT_PROXY_ERROR.UNSUPPORTED_ACTION(action),
        );
      }
    });
  }

  _handlers = {
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
      this.channelManager.updateConversationState(targetChannel, {
        sessionId: String(payload?.sessionId || "").trim(),
        dialogProcessId: String(payload?.dialogProcessId || "").trim(),
        turnScopeId: String(payload?.turnScopeId || "").trim(),
        state: CONVERSATION_STATE.STOPPING,
        sourceEvent: CONVERSATION_SOURCE_EVENT.STOP,
        seq: Number(targetChannel?.eventSequence || 0),
        createdAtMs: Number(payload?.createdAtMs || payload?.timestamp || 0),
      });
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
      if (forwarded) return;

      const errorEnvelope = this.channelManager.pushChannelEvent(
        targetChannel,
        CHANNEL_EVENT.ERROR,
        {
          sessionId: String(payload?.sessionId || "").trim(),
          dialogProcessId: String(payload?.dialogProcessId || "").trim(),
          turnScopeId: String(payload?.turnScopeId || "").trim(),
          createdAtMs: Number(payload?.createdAtMs || payload?.timestamp || 0),
          error: AGENT_PROXY_ERROR.UPSTREAM_NOT_RUNNING,
        },
      );
      this.channelManager.markChannelTerminal(targetChannel, CHANNEL_STATUS.ERROR);
      this.channelManager.broadcastChannelEvent(targetChannel, errorEnvelope);
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
      this.channelManager.handleReconnect(socket, payload);
    },
  };

  _forwardRunAction(socket, payload, action) {
    const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
    if (!targetChannel) {
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
    const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
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
    targetChannel.cleanupAfterMs = 0;
    targetChannel.upstreamClosed = false;
    targetChannel._errorHandled = false;
    targetChannel.status = CHANNEL_STATUS.CONNECTING;

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
