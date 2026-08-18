/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  AGENT_PROXY_ERROR,
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  UPSTREAM_CLOSE_REASON,
} from "../../shared/constants.js";
import {
  nowMs,
  buildUpstreamUrl,
} from "../../shared/utils.js";
import { writeAgentProxyRouteLifecycleEvent } from "../../runtime-events/ws-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../../runtime-events/agent-transport-debug-runtime-events.js";
import {
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_SNAPSHOT_WIRE_EVENT,
} from "@noobot/session-protocol";
import {
  AGENT_TRANSPORT_DEBUG_TYPE,
  AGENT_TRANSPORT_EVENT,
  createAgentTransportError,
  validateAgentCommandReceipt,
  validateAgentTransportError,
  summarizeAgentTransportCommand,
} from "@noobot/agent-transport-protocol";
import { validateProtocolEvent } from "@noobot/event-protocol";
import {
  TURN_COMMITTED_WIRE_EVENT,
  assertTurnCommittedEventData,
} from "@noobot/session-protocol/turn-commit";

function assertUpstreamDataPlaneEvent(eventName, eventData) {
  if (eventName === AGENT_TRANSPORT_EVENT.ERROR) {
    const validation = validateAgentTransportError(eventData);
    if (!validation.valid) throw new TypeError(validation.errors.join(","));
    return;
  }
  if (eventName === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT) {
    const validation = validateAgentCommandReceipt(eventData);
    if (!validation.valid) throw new TypeError(validation.errors.join(","));
    return;
  }
  if (eventName === TURN_COMMITTED_WIRE_EVENT) {
    assertTurnCommittedEventData(eventData);
    return;
  }
  const validation = validateProtocolEvent(eventData);
  if (!validation.valid) throw new TypeError(validation.errors.join(","));
  if (String(eventData?.identity?.eventType || "").trim() !== eventName) {
    throw new TypeError("wire_event_identity_mismatch");
  }
}

class UpstreamConnectionMethods {

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
  channel.transport.close(closeCode, reasonText);
}

markChannelTerminal(channel, terminalStatus = CHANNEL_STATUS.DONE) {
  if (!channel) return false;
  if (channel.pendingInteractionRequests.size) {
    this.logSessionEvent(channel, {
      category: "state",
      level: "warn",
      event: "agentProxy.channel.terminal.rejected",
      data: {
        channelKey: channel.key,
        status: String(terminalStatus || CHANNEL_STATUS.DONE).trim(),
        reason: "pending_interaction",
        pendingRequestIds: Array.from(channel.pendingInteractionRequests.keys()),
      },
    });
    return false;
  }
  channel.activity.phase = CHANNEL_STATUS.IDLE;
  channel.retention.phase = CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED;
  channel.retention.terminalStatus = String(terminalStatus || CHANNEL_STATUS.DONE).trim();
  channel.updatedAtMs = nowMs();
  channel.retention.cleanupAfterMs = nowMs() + config.channelRetentionMs;
  this.logSessionEvent(channel, {
    category: "state",
    event: "agentProxy.channel.terminal",
    data: { channelKey: channel.key, status: channel.retention.terminalStatus, cleanupAfterMs: channel.retention.cleanupAfterMs },
  });
  return true;
}

connectUpstreamChannel(channel, apiKey = "", locale = "", options = {}) {
  if (!channel || channel.upstreamSocket) return;
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.upstreamConnect.started",
    channel,
    data: { localePresent: Boolean(String(locale || "").trim()) },
  });
  channel._errorHandled = false;
  const upstreamUrl = buildUpstreamUrl(config.upstreamWsUrl, apiKey);
  if (!upstreamUrl) {
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.connect.skipped",
      data: { channelKey: channel.key, reason: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY },
    });
    const errorEnvelope = this.pushChannelEvent(channel, AGENT_TRANSPORT_EVENT.ERROR, createAgentTransportError({
      code: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
      message: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
      identity: { sessionId: channel.startPayload?.sessionId },
    }));
    this.broadcastChannelEvent(channel, errorEnvelope);
    return;
  }
  channel.apiKey = String(apiKey || "").trim();
  channel.locale = String(locale || "").trim();
  channel.updatedAtMs = nowMs();
  this.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.upstream.connecting",
    data: { channelKey: channel.key, locale: channel.locale },
  });

  const connection = channel.transport.connect(upstreamUrl, {
  open: ({ socket: upstreamSocket }) => {
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.upstreamConnect.succeeded",
      channel,
    });
    if (
      channel.retention.phase === CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED &&
      options.purpose !== "snapshot_query"
    ) {
      this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLOSED);
      return;
    }
    channel.updatedAtMs = nowMs();
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.open",
      data: { channelKey: channel.key, status: channel.transport.phase },
    });
    const hasExplicitInitialPayload = Object.prototype.hasOwnProperty.call(options, "initialPayload");
    const payloadToSend = hasExplicitInitialPayload
      ? options.initialPayload
      : channel.startPayload && typeof channel.startPayload === "object"
        ? { ...channel.startPayload }
        : null;
    const initialCommands = Array.isArray(options.initialCommands)
      ? options.initialCommands.filter((item) => item && typeof item === "object")
      : [];
    try {
      if (payloadToSend) {
        upstreamSocket.send(JSON.stringify(payloadToSend));
        void writeAgentTransportDebugEvent({
          event: "agentProxy.agentTransport.commandForwarded",
          command: payloadToSend,
          channel,
          data: { forwarded: true, transport: "websocket", initialCommand: true },
        });
      }
      for (const command of initialCommands) {
        upstreamSocket.send(JSON.stringify(command));
        void writeAgentTransportDebugEvent({
          event: "agentProxy.agentTransport.commandForwarded",
          command,
          channel,
          data: { forwarded: true, transport: "websocket", initialCommand: true },
        });
      }
    } catch (error) {
      const failedCommand = payloadToSend || initialCommands[0] || {};
      void writeAgentTransportDebugEvent({
        event: "agentProxy.agentTransport.forwardFailed",
        command: failedCommand,
        channel,
        data: {
          forwarded: false,
          reason: "initial_send_error",
          errorType: String(error?.name || "Error"),
          errorCode: String(error?.code || ""),
          initialCommand: true,
        },
      });
      this.logSessionEvent(channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.upstream.initialPayload.error",
        data: { channelKey: channel.key, error: String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD) },
      });
      const message = String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD);
      const errorEnvelope = this.pushChannelEvent(channel, AGENT_TRANSPORT_EVENT.ERROR, createAgentTransportError({
        code: AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD,
        message,
        identity: { sessionId: channel.startPayload?.sessionId },
      }));
      this.broadcastChannelEvent(channel, errorEnvelope);
      this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.SEND_FAILED);
    }
  },

  message: ({ rawData }) => {
    try {
      const parsed = JSON.parse(String(rawData || "{}"));
      const eventName = String(parsed?.event || "").trim();
      if (!eventName) throw new TypeError("missing_upstream_event");
      const eventData =
        parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
      const isQueryResponse =
        eventName === TURN_SNAPSHOT_WIRE_EVENT ||
        Boolean(String(eventData?.commandId || "").trim() && channel.pendingExecutionRequests?.has(String(eventData.commandId).trim()));
      if (!isQueryResponse) assertUpstreamDataPlaneEvent(eventName, eventData);
      const lifecycle = eventData?.payload || {};
      if (
        eventName === TURN_LIFECYCLE_WIRE_EVENT &&
        String(lifecycle?.eventType || "").trim() === TURN_EVENT.ACTION_ACCEPTED
      ) {
        const summary = summarizeAgentTransportCommand(channel.startPayload, {
          accepted: true,
          consumedByService: true,
          transport: "websocket",
          lifecycleEventType: TURN_EVENT.ACTION_ACCEPTED,
          lifecycleEventId: String(eventData?.identity?.eventId || "").trim(),
          lifecycleRevision: Number(eventData?.ordering?.revision || 0),
        });
        this.logSessionEvent(channel, {
          category: "debug",
          level: "debug",
          debugType: AGENT_TRANSPORT_DEBUG_TYPE,
          event: "agentProxy.agentTransport.commandAccepted",
          sessionId: summary.sessionId,
          dialogProcessId: summary.dialogProcessId,
          turnScopeId: summary.turnScopeId,
          data: {
            debugType: AGENT_TRANSPORT_DEBUG_TYPE,
            event: "agentProxy.agentTransport.commandAccepted",
            ...summary,
          },
        });
      }
      if (eventName === TURN_SNAPSHOT_WIRE_EVENT) {
        const commandId = String(eventData?.causality?.commandId || "").trim();
        const requester = commandId ? channel.pendingSnapshotRequests?.get(commandId) : null;
        if (requester) {
          channel.pendingSnapshotRequests.delete(commandId);
          if (typeof requester?.resolve === "function") {
            requester.resolve({ ok: true, snapshot: eventData });
          } else {
            this.sendSocketEvent(requester, { event: eventName, data: eventData });
          }
        }
        return;
      }
      const commandId = String(eventData?.commandId || "").trim();
      const executionRequester = commandId
        ? channel.pendingExecutionRequests?.get(commandId)
        : null;
      if (executionRequester) {
        channel.pendingExecutionRequests.delete(commandId);
        this.sendSocketEvent(executionRequester, { event: eventName, data: eventData });
        return;
      }
      if (eventName === AGENT_TRANSPORT_EVENT.ERROR) {
        const requester = commandId ? channel.pendingSnapshotRequests?.get(commandId) : null;
        if (typeof requester?.resolve === "function") {
          channel.pendingSnapshotRequests.delete(commandId);
          requester.resolve({
            ok: false,
            reason: eventData.code,
          });
          return;
        }
      }
      const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
      this.recordSuccessfulDataPlaneOperation("upstreamMessages");
      this.broadcastChannelEvent(channel, eventEnvelope);
    } catch (error) {
      this.logSessionEvent(channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.upstream.message.error",
        data: { channelKey: channel.key, error: String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT) },
      });
      const message = String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT);
      const errorEnvelope = this.pushChannelEvent(channel, AGENT_TRANSPORT_EVENT.ERROR, createAgentTransportError({
        code: AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT,
        message,
        identity: { sessionId: channel.startPayload?.sessionId },
      }));
      this.broadcastChannelEvent(channel, errorEnvelope);
      this.closeUpstreamChannel(
        channel,
        1011,
        UPSTREAM_CLOSE_REASON.INVALID_UPSTREAM_EVENT,
      );
    }
  },

  close: ({ code: closeCode, reason: closeReasonBuffer }) => {
    channel.upstreamClosed = true;
    const closeReason =
      typeof closeReasonBuffer === "string"
        ? closeReasonBuffer
        : Buffer.isBuffer(closeReasonBuffer)
          ? closeReasonBuffer.toString("utf8")
          : "";
    const normalizedCloseCode = Number(closeCode || 0) || 0;
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.upstreamConnect.closed",
      channel,
      data: { closeCode: normalizedCloseCode, reasonLength: closeReason.length },
    });
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.closed",
      data: { channelKey: channel.key, closeCode: normalizedCloseCode, closeReason },
    });
  },

  error: ({ error }) => {
    if (channel._errorHandled) return;
    channel._errorHandled = true;
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.upstreamConnect.failed",
      channel,
      data: { errorType: error?.name || "Error" },
    });
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.error",
      data: { channelKey: channel.key, error: String(error?.message || "upstream websocket error") },
    });
    const message = String(error?.message || "upstream websocket error");
    const errorEnvelope = this.pushChannelEvent(channel, AGENT_TRANSPORT_EVENT.ERROR, createAgentTransportError({
      code: "UPSTREAM_WEBSOCKET_ERROR",
      message,
      identity: { sessionId: channel.startPayload?.sessionId },
    }));
    this.broadcastChannelEvent(channel, errorEnvelope);
  },
  handlerError: ({ error, handlerName }) => {
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.handler.error",
      data: {
        channelKey: channel.key,
        handlerName: String(handlerName || "unknown"),
        error: String(error?.message || "upstream handler error"),
      },
    });
  },
  }, { purpose: String(options?.purpose || "run").trim() || "run" });
  if (!connection?.socket) {
    channel.transport.phase = CHANNEL_STATUS.IDLE;
  }
  return connection;
}
}

export const upstreamconnectionMethods = Object.getOwnPropertyDescriptors(UpstreamConnectionMethods.prototype);
delete upstreamconnectionMethods.constructor;
