import { config } from "../config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
  CHANNEL_STATUS,
  UPSTREAM_CLOSE_REASON,
} from "../constants.js";
import { nowMs, isTerminalStatus, buildUpstreamUrl } from "../utils.js";

class UpstreamConnectionMethods {
// ---- Upstream Connection ----

closeUpstreamChannel(
  channel,
  closeCode = 1000,
  reasonText = UPSTREAM_CLOSE_REASON.CLOSED,
) {
  if (!channel?.upstreamSocket) return;
  this.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.upstream.close.requested",
    data: { channelKey: channel.key, closeCode, reason: reasonText },
  });
  try {
    channel.upstreamSocket.close(closeCode, reasonText);
  } catch {
    // ignore close errors
  }
  channel.upstreamSocket = null;
}

markChannelTerminal(channel, terminalStatus = CHANNEL_STATUS.DONE) {
  if (!channel) return;
  channel.status = String(terminalStatus || CHANNEL_STATUS.DONE).trim();
  channel.updatedAtMs = nowMs();
  channel.cleanupAfterMs = nowMs() + config.channelRetentionMs;
  channel.pendingInteractionRequests.clear();
  this.logSessionEvent(channel, {
    category: "state",
    event: "agentProxy.channel.terminal",
    data: { channelKey: channel.key, status: channel.status, cleanupAfterMs: channel.cleanupAfterMs },
  });
}

connectUpstreamChannel(channel, apiKey = "", locale = "") {
  if (!channel || channel.upstreamSocket) return;
  channel._errorHandled = false;
  const upstreamUrl = buildUpstreamUrl(config.upstreamWsUrl, apiKey);
  if (!upstreamUrl) {
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.connect.skipped",
      data: { channelKey: channel.key, reason: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY },
    });
    const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
      error: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
    });
    this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
    this.broadcastChannelEvent(channel, errorEnvelope);
    return;
  }
  const upstreamSocket = new this.WebSocket(upstreamUrl);
  channel.upstreamSocket = upstreamSocket;
  channel.status = CHANNEL_STATUS.CONNECTING;
  channel.apiKey = String(apiKey || "").trim();
  channel.locale = String(locale || "").trim();
  channel.updatedAtMs = nowMs();
  this.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.upstream.connecting",
    data: { channelKey: channel.key, locale: channel.locale },
  });

  upstreamSocket.on("open", () => {
    if (isTerminalStatus(channel.status)) {
      this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLOSED);
      return;
    }
    channel.status = CHANNEL_STATUS.RUNNING;
    channel.updatedAtMs = nowMs();
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.open",
      data: { channelKey: channel.key, status: channel.status },
    });
    const payloadToSend =
      channel.startPayload && typeof channel.startPayload === "object"
        ? { ...channel.startPayload }
        : null;
    if (!payloadToSend) return;
    try {
      upstreamSocket.send(JSON.stringify(payloadToSend));
    } catch (error) {
      this.logSessionEvent(channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.upstream.initialPayload.error",
        data: { channelKey: channel.key, error: String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD) },
      });
      const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
        error: String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD),
      });
      this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      this.broadcastChannelEvent(channel, errorEnvelope);
      this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.SEND_FAILED);
    }
  });

  upstreamSocket.on(CHANNEL_EVENT.MESSAGE, (rawData) => {
    try {
      const parsed = JSON.parse(String(rawData || "{}"));
      const eventName = String(parsed?.event || CHANNEL_EVENT.MESSAGE).trim() || CHANNEL_EVENT.MESSAGE;
      const eventData =
        parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
      this.logSessionEvent(channel, {
        category: "transport",
        event: "agentProxy.upstream.message",
        data: {
          channelKey: channel.key,
          event: eventName,
          sequence: eventEnvelope?.sequence,
          sessionId: eventData?.sessionId,
          dialogProcessId: eventData?.dialogProcessId,
          turnScopeId: eventData?.turnScopeId,
          hasContent: Boolean(eventData?.content || eventData?.text),
        },
      });
      this.broadcastChannelEvent(channel, eventEnvelope);
      if (eventName === CHANNEL_EVENT.DONE) {
        this.markChannelTerminal(channel, CHANNEL_STATUS.DONE);
      } else if (eventName === CHANNEL_EVENT.USER_STOPPED) {
        this.markChannelTerminal(channel, CHANNEL_STATUS.USER_STOPPED);
      } else if (eventName === CHANNEL_EVENT.ERROR) {
        this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      } else if (!isTerminalStatus(channel.status)) {
        channel.status = CHANNEL_STATUS.RUNNING;
      }
    } catch (error) {
      this.logSessionEvent(channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.upstream.message.error",
        data: { channelKey: channel.key, error: String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT) },
      });
      const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
        error: String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT),
      });
      this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      this.broadcastChannelEvent(channel, errorEnvelope);
      this.closeUpstreamChannel(
        channel,
        1011,
        UPSTREAM_CLOSE_REASON.INVALID_UPSTREAM_EVENT,
      );
    }
  });

  upstreamSocket.on("close", (closeCode, closeReasonBuffer) => {
    channel.upstreamSocket = null;
    channel.upstreamClosed = true;
    const closeReason =
      typeof closeReasonBuffer === "string"
        ? closeReasonBuffer
        : Buffer.isBuffer(closeReasonBuffer)
          ? closeReasonBuffer.toString("utf8")
          : "";
    const normalizedCloseCode = Number(closeCode || 0) || 0;
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.closed",
      data: { channelKey: channel.key, closeCode: normalizedCloseCode, closeReason },
    });
    if (!isTerminalStatus(channel.status)) {
      if (closeReason === "user_stopped") {
        this.markChannelTerminal(channel, CHANNEL_STATUS.USER_STOPPED);
        const stoppedEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.USER_STOPPED, {
          message: "upstream confirmed user stop",
          upstreamCloseCode: normalizedCloseCode,
          upstreamCloseReason: closeReason,
        });
        this.broadcastChannelEvent(channel, stoppedEnvelope);
        return;
      }
      this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
      const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
        error: "upstream socket closed before terminal event",
        upstreamCloseCode: normalizedCloseCode,
        upstreamCloseReason: closeReason || "upstream socket closed",
      });
      this.broadcastChannelEvent(channel, errorEnvelope);
    }
  });

  upstreamSocket.on(CHANNEL_EVENT.ERROR, (error) => {
    if (channel._errorHandled) return;
    channel._errorHandled = true;
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.error",
      data: { channelKey: channel.key, error: String(error?.message || "upstream websocket error") },
    });
    const errorEnvelope = this.pushChannelEvent(channel, CHANNEL_EVENT.ERROR, {
      error: String(error?.message || "upstream websocket error"),
    });
    this.markChannelTerminal(channel, CHANNEL_STATUS.ERROR);
    this.broadcastChannelEvent(channel, errorEnvelope);
  });
}
}

export const upstreamconnectionMethods = Object.getOwnPropertyDescriptors(UpstreamConnectionMethods.prototype);
delete upstreamconnectionMethods.constructor;
