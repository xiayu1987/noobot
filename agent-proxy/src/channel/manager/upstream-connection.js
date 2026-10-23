/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  CHANNEL_ACTIVITY_PHASE,
  CHANNEL_RETENTION_PHASE,
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
  AGENT_CHANNEL_STATE,
  AGENT_TRANSPORT_DEBUG_TYPE,
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_ERROR_CODE,
  AGENT_TRANSPORT_EVENT,
  createAgentCommandRejection,
  summarizeAgentTransportCommand,
} from "@noobot/agent-transport-protocol";
import { assertLocatableDataPlaneEvent } from "./data-plane-event-validator.js";
import { PENDING_COMMAND_KIND } from "../command-registry.js";
import { text } from "@noobot/shared/value";

const EXECUTION_QUERY_WIRE_EVENTS = new Set(
  Object.values(EXECUTION_QUERY_CONTRACT).map((contract) => contract.wireEvent),
);
const CHANNEL_TERMINAL_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.COMPLETED,
  AGENT_CHANNEL_STATE.USER_STOPPED,
  AGENT_CHANNEL_STATE.ERROR,
]);

class UpstreamConnectionMethods {
  closeUpstreamChannel(channel, closeCode, reasonText) {
    if (!channel.transport.socket) return;
    this.logChannelEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.close.requested",
      data: { channelKey: channel.key, closeCode, reason: reasonText },
    });
    channel.transport.close(closeCode, reasonText);
  }

  markChannelTerminal(channel, terminalStatus) {
    if (!CHANNEL_TERMINAL_STATES.includes(terminalStatus)) {
      throw new TypeError(`invalid channel terminal status: ${terminalStatus}`);
    }
    if (channel.pendingInteractionRequests.size) {
      this.logChannelEvent(channel, {
        category: "state",
        level: "warn",
        event: "agentProxy.channel.terminal.rejected",
        data: {
          channelKey: channel.key,
          status: terminalStatus,
          reason: "pending_interaction",
          pendingRequestIds: Array.from(channel.pendingInteractionRequests.keys()),
        },
      });
      return false;
    }
    channel.activity.phase = CHANNEL_ACTIVITY_PHASE.IDLE;
    channel.retention.phase = CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED;
    channel.retention.terminalStatus = terminalStatus;
    channel.updatedAtMs = nowMs();
    channel.retention.cleanupAfterMs = nowMs() + config.channelRetentionMs;
    this.logChannelEvent(channel, {
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

  connectUpstreamChannel(channel, apiKey, locale, { initialCommands, purpose }) {
    if (channel.transport.socket) return null;
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.upstreamConnect.started",
      channel,
      data: { localePresent: Boolean(text(locale)) },
    });
    channel._errorHandled = false;
    channel.locale = text(locale);
    const upstreamUrl = buildUpstreamUrl(config.upstreamWsUrl, apiKey);
    if (!upstreamUrl) {
      this.logChannelEvent(channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.upstream.connect.skipped",
        data: { channelKey: channel.key, reason: AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_URL_EMPTY },
      });
      this.broadcastChannelError(channel, AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_URL_EMPTY);
      return;
    }
    channel.apiKey = text(apiKey);
    channel.updatedAtMs = nowMs();
    this.logChannelEvent(channel, {
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
            purpose !== "snapshot_query"
          ) {
            this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLOSED);
            return;
          }
          channel.updatedAtMs = nowMs();
          this.logChannelEvent(channel, {
            category: "transport",
            event: "agentProxy.upstream.open",
            data: { channelKey: channel.key, status: channel.transport.phase },
          });
          let currentCommand = null;
          try {
            for (const command of initialCommands) {
              currentCommand = command;
              upstreamSocket.send(JSON.stringify(command));
              void writeAgentTransportDebugEvent({
                event: "agentProxy.agentTransport.commandForwarded",
                command,
                channel,
                data: { forwarded: true, transport: "websocket", initialCommand: true },
              });
            }
          } catch (error) {
            void writeAgentTransportDebugEvent({
              event: "agentProxy.agentTransport.forwardFailed",
              command: currentCommand,
              channel,
              data: {
                forwarded: false,
                reason: "initial_send_error",
                errorType: error.name,
                initialCommand: true,
              },
            });
            this.logChannelEvent(channel, {
              category: "transport",
              level: "error",
              event: "agentProxy.upstream.initialPayload.error",
              data: {
                channelKey: channel.key,
                error: String(error?.message || ""),
              },
            });
            this.broadcastChannelError(channel, AGENT_TRANSPORT_ERROR_CODE.FAILED_TO_SEND_PAYLOAD);
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
          this.logChannelEvent(channel, {
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
          this.logChannelEvent(channel, {
            category: "transport",
            level: "error",
            event: "agentProxy.upstream.error",
            data: {
              channelKey: channel.key,
              error: String(error?.message || "upstream websocket error"),
            },
          });
          this.broadcastChannelError(channel, AGENT_TRANSPORT_ERROR_CODE.UPSTREAM_WEBSOCKET_ERROR);
        },
        handlerError: ({ error, handlerName }) => {
          this.logChannelEvent(channel, {
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
      { purpose },
    );
    return connection;
  }

  parseUpstreamMessage(rawData) {
    const parsed = JSON.parse(String(rawData || "{}"));
    const eventName = text(parsed?.event);
    if (!eventName) throw new TypeError("missing_upstream_event");
    const eventData = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
    if (eventName !== TURN_SNAPSHOT_WIRE_EVENT) assertLocatableDataPlaneEvent(eventName, eventData);
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
    this.logChannelEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.message.dropped",
      data: {
        channelKey: channel.key,
        ...locator,
        error: String(error.message || ""),
        invalidFramesInWindow: recent.length,
        invalidFrameLimit: config.invalidUpstreamFrameLimit,
      },
    });
    return true;
  }

  logUpstreamActionAccepted(channel, eventName, eventData) {
    const lifecycle = eventData?.payload || {};
    if (eventName !== TURN_LIFECYCLE_WIRE_EVENT) return;
    if (text(lifecycle?.eventType) !== TURN_EVENT.ACTION_ACCEPTED) return;
    const summary = summarizeAgentTransportCommand(channel.startPayload, {
      accepted: true,
      consumedByService: true,
      transport: "websocket",
      lifecycleEventType: TURN_EVENT.ACTION_ACCEPTED,
      lifecycleEventId: text(eventData?.identity?.eventId),
      lifecycleRevision: Number(eventData?.ordering?.revision || 0),
    });
    this.logChannelEvent(channel, {
      category: "debug",
      level: "debug",
      debugType: AGENT_TRANSPORT_DEBUG_TYPE,
      event: "agentProxy.agentTransport.commandAccepted",
      data: {
        event: "agentProxy.agentTransport.commandAccepted",
        ...summary,
      },
    });
  }

  takePendingCommand(channel, commandId, kind, reason) {
    return this.commandRegistry.take(commandId, { channelKey: channel.key, kind }, reason);
  }

  routeUpstreamSnapshot(channel, eventData) {
    const { commandId } = eventData.causality;
    const record = this.takePendingCommand(
      channel,
      commandId,
      PENDING_COMMAND_KIND.TURN_SNAPSHOT,
      "delivered",
    );
    if (!record) return;
    record.settle({ ok: true, snapshot: eventData });
  }

  resolvePendingSnapshotFailure(channel, receipt) {
    const record = this.takePendingCommand(
      channel,
      receipt.commandId,
      PENDING_COMMAND_KIND.TURN_SNAPSHOT,
      "snapshot_failed",
    );
    if (!record) return false;
    record.settle({ ok: false, reason: receipt.error.code });
    return true;
  }

  deliverExecutionQueryResult(channel, eventName, eventData, commandId) {
    const record = this.takePendingCommand(
      channel,
      commandId,
      PENDING_COMMAND_KIND.EXECUTION_QUERY,
      "delivered",
    );
    if (!record) return false;
    record.settle({ event: eventName, data: eventData });
    return true;
  }

  rejectPendingExecutionQuery(channel, receipt) {
    const record = this.takePendingCommand(
      channel,
      receipt.commandId,
      PENDING_COMMAND_KIND.EXECUTION_QUERY,
      "rejected",
    );
    if (!record) return false;
    record.settle({
      event: AGENT_TRANSPORT_EVENT.COMMAND_REJECTED,
      data: createAgentCommandRejection({
        command: receipt,
        error: receipt.error,
        occurredAt: receipt.occurredAt,
      }),
    });
    return true;
  }

  routeFailedQueryReceipt(channel, eventName, eventData) {
    if (eventName !== AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT) return false;
    if (eventData.outcome !== AGENT_COMMAND_RECEIPT_OUTCOME.FAILED) return false;
    return (
      this.resolvePendingSnapshotFailure(channel, eventData) ||
      this.rejectPendingExecutionQuery(channel, eventData)
    );
  }

  routeExecutionQueryResponse(channel, eventName, eventData) {
    if (!EXECUTION_QUERY_WIRE_EVENTS.has(eventName)) return false;
    const commandId = eventData.causality.commandId;
    if (this.deliverExecutionQueryResult(channel, eventName, eventData, commandId)) return true;
    const removal = this.commandRegistry.lastRemoval(commandId);
    this.logChannelEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.executionQuery.orphanDropped",
      data: {
        channelKey: channel.key,
        eventName,
        commandId,
        removalReason: removal ? removal.reason : "never_registered",
        registeredForMs: removal ? removal.registeredForMs : null,
        sinceRemovalMs: removal ? Math.max(0, nowMs() - removal.removedAtMs) : null,
      },
    });
    return true;
  }

  handleUpstreamMessage(channel, rawData) {
    const { eventName, eventData } = this.parseUpstreamMessage(rawData);
    this.logUpstreamActionAccepted(channel, eventName, eventData);
    if (eventName === TURN_SNAPSHOT_WIRE_EVENT) {
      this.routeUpstreamSnapshot(channel, eventData);
      return;
    }
    if (this.routeExecutionQueryResponse(channel, eventName, eventData)) return;
    if (this.routeFailedQueryReceipt(channel, eventName, eventData)) return;
    const eventEnvelope = this.pushChannelEvent(channel, eventName, eventData);
    this.recordSuccessfulDataPlaneOperation("upstreamMessages");
    this.broadcastChannelEvent(channel, eventEnvelope);
  }

  reportUpstreamMessageError(channel, error) {
    if (this.recordDroppableUpstreamFrame(channel, error)) return;
    this.logChannelEvent(channel, {
      category: "transport",
      level: "error",
      event: "agentProxy.upstream.message.error",
      data: {
        channelKey: channel.key,
        error: String(error?.message || ""),
      },
    });
    this.broadcastChannelError(channel, AGENT_TRANSPORT_ERROR_CODE.INVALID_UPSTREAM_EVENT);
    this.closeUpstreamChannel(channel, 1011, UPSTREAM_CLOSE_REASON.INVALID_UPSTREAM_EVENT);
  }
}

export const upstreamconnectionMethods = Object.getOwnPropertyDescriptors(
  UpstreamConnectionMethods.prototype,
);
delete upstreamconnectionMethods.constructor;
