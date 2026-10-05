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
import { nowMs, buildUpstreamUrl } from "../../shared/utils.js";
import { writeAgentProxyRouteLifecycleEvent } from "../../runtime-events/ws-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../../runtime-events/agent-transport-debug-runtime-events.js";
import {
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_SNAPSHOT_WIRE_EVENT,
} from "@noobot/session-protocol";
import { EXECUTION_QUERY_CONTRACT } from "@noobot/session-protocol/execution-lifecycle";
import {
  AGENT_TRANSPORT_DEBUG_TYPE,
  AGENT_TRANSPORT_EVENT,
  createAgentTransportError,
  summarizeAgentTransportCommand,
} from "@noobot/agent-transport-protocol";
import { assertLocatableDataPlaneEvent } from "./data-plane-event-validator.js";

const EXECUTION_QUERY_WIRE_EVENTS = new Set(
  Object.values(EXECUTION_QUERY_CONTRACT).map((contract) => contract.wireEvent),
);

class UpstreamConnectionMethods {
  closeUpstreamChannel(channel, closeCode = 1000, reasonText = UPSTREAM_CLOSE_REASON.CLOSED) {
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
      data: {
        channelKey: channel.key,
        status: channel.retention.terminalStatus,
        cleanupAfterMs: channel.retention.cleanupAfterMs,
      },
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
      const errorEnvelope = this.pushChannelEvent(
        channel,
        AGENT_TRANSPORT_EVENT.ERROR,
        createAgentTransportError({
          code: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
          message: AGENT_PROXY_ERROR.UPSTREAM_URL_EMPTY,
          identity: { sessionId: channel.startPayload?.sessionId },
        }),
      );
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

    const connection = channel.transport.connect(
      upstreamUrl,
      {
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
          const hasExplicitInitialPayload = Object.prototype.hasOwnProperty.call(
            options,
            "initialPayload",
          );
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
              data: {
                channelKey: channel.key,
                error: String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD),
              },
            });
            const message = String(error?.message || AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD);
            const errorEnvelope = this.pushChannelEvent(
              channel,
              AGENT_TRANSPORT_EVENT.ERROR,
              createAgentTransportError({
                code: AGENT_PROXY_ERROR.FAILED_TO_SEND_PAYLOAD,
                message,
                identity: { sessionId: channel.startPayload?.sessionId },
              }),
            );
            this.broadcastChannelEvent(channel, errorEnvelope);
            this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.SEND_FAILED);
          }
        },

        message: ({ rawData }) => {
          try {
            this.handleUpstreamMessage(channel, rawData);
          } catch (error) {
            this.reportUpstreamMessageError(channel, error);
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
            data: {
              channelKey: channel.key,
              error: String(error?.message || "upstream websocket error"),
            },
          });
          const message = String(error?.message || "upstream websocket error");
          const errorEnvelope = this.pushChannelEvent(
            channel,
            AGENT_TRANSPORT_EVENT.ERROR,
            createAgentTransportError({
              code: "UPSTREAM_WEBSOCKET_ERROR",
              message,
              identity: { sessionId: channel.startPayload?.sessionId },
            }),
          );
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
      },
      { purpose: String(options?.purpose || "run").trim() || "run" },
    );
    if (!connection?.socket) {
      channel.transport.phase = CHANNEL_STATUS.IDLE;
    }
    return connection;
  }

  parseUpstreamMessage(channel, rawData) {
    const parsed = JSON.parse(String(rawData || "{}"));
    const eventName = String(parsed?.event || "").trim();
    if (!eventName) throw new TypeError("missing_upstream_event");
    const eventData = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
    const queryCommandId = String(eventData?.commandId || "").trim();
    const isQueryResponse =
      eventName === TURN_SNAPSHOT_WIRE_EVENT ||
      Boolean(
        queryCommandId &&
        (EXECUTION_QUERY_WIRE_EVENTS.has(eventName) ||
          channel.pendingExecutionRequests?.has(queryCommandId)),
      );
    if (!isQueryResponse) assertLocatableDataPlaneEvent(eventName, eventData);
    return { eventName, eventData };
  }

  recordDroppableUpstreamFrame(channel, error) {
    const locator = error?.frameLocator;
    if (!locator) return false;
    const currentMs = nowMs();
    const windowStartMs = currentMs - config.invalidUpstreamFrameWindowMs;
    const recent = (channel.invalidUpstreamFrameAtMs || []).filter((atMs) => atMs > windowStartMs);
    recent.push(currentMs);
    channel.invalidUpstreamFrameAtMs = recent;
    if (recent.length > config.invalidUpstreamFrameLimit) return false;
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.message.dropped",
      data: {
        channelKey: channel.key,
        ...locator,
        error: String(error.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT),
        invalidFramesInWindow: recent.length,
        invalidFrameLimit: config.invalidUpstreamFrameLimit,
      },
    });
    return true;
  }

  logUpstreamActionAccepted(channel, eventName, eventData) {
    const lifecycle = eventData?.payload || {};
    if (eventName !== TURN_LIFECYCLE_WIRE_EVENT) return;
    if (String(lifecycle?.eventType || "").trim() !== TURN_EVENT.ACTION_ACCEPTED) return;
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
        event: "agentProxy.agentTransport.commandAccepted",
        ...summary,
      },
    });
  }

  routeUpstreamSnapshot(channel, eventName, eventData) {
    const commandId = String(eventData?.causality?.commandId || "").trim();
    const requester = commandId ? channel.pendingSnapshotRequests?.get(commandId) : null;
    if (!requester) return;
    channel.pendingSnapshotRequests.delete(commandId, "delivered");
    if (typeof requester?.resolve === "function") {
      requester.resolve({ ok: true, snapshot: eventData });
    } else {
      this.sendSocketEvent(requester, { event: eventName, data: eventData });
    }
  }

  resolvePendingSnapshotFailure(channel, commandId, reason) {
    const requester = commandId ? channel.pendingSnapshotRequests?.get(commandId) : null;
    if (typeof requester?.resolve !== "function") return false;
    channel.pendingSnapshotRequests.delete(commandId, "snapshot_failed");
    requester.resolve({ ok: false, reason });
    return true;
  }

  routeExecutionQueryResponse(channel, eventName, eventData, commandId) {
    const executionRequester = commandId ? channel.pendingExecutionRequests?.get(commandId) : null;
    if (executionRequester) {
      channel.pendingExecutionRequests.delete(commandId, "delivered");
      this.sendSocketEvent(executionRequester, { event: eventName, data: eventData });
      return true;
    }
    if (!EXECUTION_QUERY_WIRE_EVENTS.has(eventName)) return false;
    const removal = this.commandRegistry?.lastRemoval?.(commandId) || null;
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.executionQuery.orphanDropped",
      data: {
        channelKey: channel.key,
        eventName,
        commandId,
        removalReason: removal?.reason || "never_registered",
        registeredForMs: removal?.registeredForMs ?? null,
        sinceRemovalMs: removal ? Math.max(0, nowMs() - removal.removedAtMs) : null,
      },
    });
    return true;
  }

  handleUpstreamMessage(channel, rawData) {
    const { eventName, eventData } = this.parseUpstreamMessage(channel, rawData);
    this.logUpstreamActionAccepted(channel, eventName, eventData);
    if (eventName === TURN_SNAPSHOT_WIRE_EVENT) {
      this.routeUpstreamSnapshot(channel, eventName, eventData);
      return;
    }
    const commandId = String(eventData?.commandId || "").trim();
    if (
      eventName === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
      this.resolvePendingSnapshotFailure(
        channel,
        commandId,
        String(eventData?.error?.code || eventData?.outcome || "snapshot_failed").trim(),
      )
    ) {
      return;
    }
    if (this.routeExecutionQueryResponse(channel, eventName, eventData, commandId)) return;
    if (
      eventName === AGENT_TRANSPORT_EVENT.ERROR &&
      this.resolvePendingSnapshotFailure(channel, commandId, eventData.code)
    ) {
      return;
    }
    const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
    this.recordSuccessfulDataPlaneOperation("upstreamMessages");
    this.broadcastChannelEvent(channel, eventEnvelope);
  }

  reportUpstreamMessageError(channel, error) {
    if (this.recordDroppableUpstreamFrame(channel, error)) return;
    this.logSessionEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.message.error",
      data: {
        channelKey: channel.key,
        error: String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT),
      },
    });
    const message = String(error?.message || AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT);
    const errorEnvelope = this.pushChannelEvent(
      channel,
      AGENT_TRANSPORT_EVENT.ERROR,
      createAgentTransportError({
        code: AGENT_PROXY_ERROR.INVALID_UPSTREAM_EVENT,
        message,
        identity: { sessionId: channel.startPayload?.sessionId },
      }),
    );
    this.broadcastChannelEvent(channel, errorEnvelope);
    this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.INVALID_UPSTREAM_EVENT);
  }
}

export const upstreamconnectionMethods = Object.getOwnPropertyDescriptors(
  UpstreamConnectionMethods.prototype,
);
delete upstreamconnectionMethods.constructor;
