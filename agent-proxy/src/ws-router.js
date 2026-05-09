/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "./config.js";

export class WsRouter {
  constructor(channelManager) {
    this.channelManager = channelManager;
  }

  handle(socket, connectionApiKey, connectionLocale) {
    socket.on("message", (rawData) => {
      let payload = {};
      try {
        payload = JSON.parse(String(rawData || "{}"));
      } catch {
        this.channelManager.sendSocketEvent(socket, {
          event: "error",
          data: { error: "agentProxy invalid json payload" },
        });
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
        this.channelManager.sendSocketError(socket, `agentProxy unsupported action: ${action}`);
      }
    });
  }

  _handlers = {
    stop(socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(socket, "agentProxy channel not found for stop");
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
          "agentProxy permission denied for action: stop",
        );
        return;
      }
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, { action: "stop" });
      if (!forwarded) {
        const stoppedEnvelope = this.channelManager.pushChannelEvent(targetChannel, "stopped", {
          message: "agentProxy upstream not running",
        });
        this.channelManager.markChannelTerminal(targetChannel, "stopped");
        this.channelManager.broadcastChannelEvent(targetChannel, stoppedEnvelope);
      }
    },

    interaction_response(socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(socket, "agentProxy channel not found for interaction");
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
          "agentProxy permission denied for action: interaction_response",
        );
        return;
      }
      const forwarded = this.channelManager.forwardToUpstream(targetChannel, payload);
      if (!forwarded) {
        this.channelManager.sendSocketError(socket, "agentProxy upstream is unavailable");
      }
    },

    join(socket, payload) {
      const targetChannel = this.channelManager.resolveChannelFromSocketMessage(socket, payload);
      if (!targetChannel) {
        this.channelManager.sendSocketError(socket, "agentProxy channel not found for join");
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
          "agentProxy permission denied for action: join",
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

    reconnect(socket, payload) {
      this.channelManager.handleReconnect(socket, payload);
    },
  };
}
