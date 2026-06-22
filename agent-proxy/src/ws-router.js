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
  WS_ACTION,
} from "./constants.js";

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
        clientTurnId: String(payload?.clientTurnId || "").trim(),
        state: CONVERSATION_STATE.STOPPING,
        sourceEvent: CONVERSATION_SOURCE_EVENT.STOP,
        seq: Number(targetChannel?.eventSequence || 0),
        createdAtMs: Number(payload?.createdAtMs || payload?.timestamp || 0),
      });
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
      const stoppedEnvelope = this.channelManager.pushChannelEvent(
        targetChannel,
        CHANNEL_EVENT.STOPPED,
        forwarded
          ? {
              sessionId: String(payload?.sessionId || "").trim(),
              dialogProcessId: String(payload?.dialogProcessId || "").trim(),
              clientTurnId: String(payload?.clientTurnId || "").trim(),
              createdAtMs: Number(payload?.createdAtMs || payload?.timestamp || 0),
              message: "stop requested",
            }
          : {
              message: AGENT_PROXY_ERROR.UPSTREAM_NOT_RUNNING,
            },
      );
      this.channelManager.markChannelTerminal(targetChannel, CHANNEL_STATUS.STOPPED);
      this.channelManager.broadcastChannelEvent(targetChannel, stoppedEnvelope);
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
}
