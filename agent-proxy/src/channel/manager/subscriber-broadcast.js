/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_PROXY_ERROR, CONVERSATION_STATE } from "../../shared/constants.js";
import { config } from "../../shared/config.js";
import { ensureConnectionId, nowMs, resolveMessageEventTrace } from "../../shared/utils.js";
import { localizeAgentProxyMessage } from "noobot-i18n/agent-proxy";
import {
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  validateTurnLifecycleReceipt,
} from "@noobot/session-protocol";
import {
  AGENT_TRANSPORT_EVENT,
  createAgentTransportError,
  createAgentTransportEvent,
} from "@noobot/agent-transport-protocol";

const TERMINAL_TURN_EVENTS = new Set([
  TURN_EVENT.COMPLETED,
  TURN_EVENT.STOP_COMPLETED,
  TURN_EVENT.FAILED,
]);

const isAcceptedChannelDelivery = (result = {}) =>
  result.result === "sent" || result.result === "queued";

class SubscriberBroadcastMethods {
  attachSubscriber(channel, socket, { sendStateSnapshot = true } = {}) {
    if (!channel || !socket) return;
    channel.subscribers.add(socket);
    socket.__agentProxyChannelKeys = socket.__agentProxyChannelKeys || new Set();
    socket.__agentProxyChannelKeys.add(channel.key);
    socket.__agentProxyActiveChannelKey = channel.key;
    if (sendStateSnapshot) this.sendChannelStateSnapshot(channel, socket);
  }

  detachSocketFromAllChannels(socket) {
    if (!socket) return;
    this.clearPendingLifecycleDeliveries(socket);
    const connectedChannelKeys = socket.__agentProxyChannelKeys || new Set();
    for (const channelKey of connectedChannelKeys) {
      const channel = this.channelStore.get(channelKey);
      if (!channel) continue;
      channel.subscribers.delete(socket);
      channel.updatedAtMs = nowMs();
      if (!channel.subscribers.size && channel.retention.terminalStatus) {
        channel.retention.cleanupAfterMs = nowMs() + config.channelRetentionMs;
      }
    }
    socket.__agentProxyChannelKeys = new Set();
    socket.__agentProxyActiveChannelKey = "";
    socket.__agentProxyLastSequenceByChannel = {};
  }

  clearPendingLifecycleDeliveries(socket) {
    const pendingDeliveries = socket?.__agentProxyPendingLifecycleDeliveries;
    if (!(pendingDeliveries instanceof Map)) return 0;
    for (const delivery of pendingDeliveries.values()) {
      if (delivery?.timer) clearTimeout(delivery.timer);
    }
    const cleared = pendingDeliveries.size;
    pendingDeliveries.clear();
    socket.__agentProxyLifecycleDeliveryQueues?.clear?.();
    return cleared;
  }

  acknowledgeTurnLifecycleDelivery(socket, receipt = {}) {
    const validation = validateTurnLifecycleReceipt(receipt);
    if (!validation.valid) {
      return { acknowledged: false, reason: validation.errors.join(",") };
    }
    const eventId = String(receipt.eventId).trim();
    const pendingDeliveries = socket?.__agentProxyPendingLifecycleDeliveries;
    const delivery = pendingDeliveries instanceof Map ? pendingDeliveries.get(eventId) : null;
    if (!delivery) return { acknowledged: false, reason: "delivery_not_pending" };
    if (
      String(receipt.sessionId).trim() !== delivery.sessionId ||
      String(receipt.turnScopeId).trim() !== delivery.turnScopeId
    ) {
      return { acknowledged: false, reason: "delivery_scope_mismatch" };
    }
    const deliveryQueues = socket?.__agentProxyLifecycleDeliveryQueues;
    const queue = deliveryQueues instanceof Map ? deliveryQueues.get(delivery.queueKey) : null;
    if (!queue || queue[0] !== delivery) {
      return { acknowledged: false, reason: "delivery_out_of_order" };
    }
    if (delivery.timer) clearTimeout(delivery.timer);
    pendingDeliveries.delete(eventId);
    queue.shift();
    if (!queue.length) deliveryQueues.delete(delivery.queueKey);
    this.recordSuccessfulDataPlaneOperation("lifecycleReceipts");
    if (TERMINAL_TURN_EVENTS.has(delivery.eventType)) {
      this.logSessionEvent(delivery.channel, {
        category: "transport",
        event: "agentProxy.channel.terminalLifecycle.receipt",
        sessionId: delivery.sessionId,
        dialogProcessId: delivery.dialogProcessId,
        turnScopeId: delivery.turnScopeId,
        data: {
          connectionId: ensureConnectionId(socket),
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          lifecycleSequence: delivery.lifecycleSequence,
          transportSequence: delivery.transportSequence,
          attempts: delivery.attempts,
          result: "acknowledged",
        },
      });
    }
    socket.__agentProxyLastSequenceByChannel ||= {};
    socket.__agentProxyLastSequenceByChannel[delivery.channel.key] = Math.max(
      Number(socket.__agentProxyLastSequenceByChannel[delivery.channel.key] || 0),
      delivery.transportSequence,
    );
    const nextDelivery = queue[0] || null;
    const nextDeliveryResult = nextDelivery
      ? this._deliverPendingLifecycle(socket, nextDelivery)
      : null;
    return {
      acknowledged: true,
      reason: "",
      receipt: {
        channel: delivery.channel,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        sessionId: delivery.sessionId,
        dialogProcessId: delivery.dialogProcessId,
        turnScopeId: delivery.turnScopeId,
        lifecycleSequence: delivery.lifecycleSequence,
        transportSequence: delivery.transportSequence,
        attempts: delivery.attempts,
      },
      nextDeliveryResult,
    };
  }

  sendChannelEvent(channel, targetSocket, envelope) {
    if (!targetSocket) return { result: "skipped", reason: "socket_missing" };
    const deliveryEnvelope = this.projectChannelEventForDelivery(channel, envelope);
    if (envelope?.event !== TURN_LIFECYCLE_WIRE_EVENT) {
      return this.sendSocketEvent(targetSocket, deliveryEnvelope);
    }
    const eventEnvelope = envelope?.data || {};
    const eventData = eventEnvelope?.payload || {};
    const eventId = String(eventEnvelope?.identity?.eventId || "").trim();
    const sessionId = String(eventEnvelope?.identity?.sessionId || "").trim();
    const turnScopeId = String(eventEnvelope?.identity?.turnScopeId || "").trim();
    if (!channel || !eventId || !sessionId || !turnScopeId) {
      return { result: "failed", reason: "invalid_lifecycle_delivery_identity" };
    }
    targetSocket.__agentProxyPendingLifecycleDeliveries ||= new Map();
    targetSocket.__agentProxyLifecycleDeliveryQueues ||= new Map();
    const pendingDeliveries = targetSocket.__agentProxyPendingLifecycleDeliveries;
    const existing = pendingDeliveries.get(eventId);
    if (existing) {
      return {
        result: existing.timer ? "sent" : "queued",
        reason: existing.timer ? "awaiting_receipt" : "waiting_for_prior_receipt",
      };
    }
    const queueKey = `${channel.key}\u0000${sessionId}\u0000${turnScopeId}`;
    const delivery = {
      channel,
      envelope: deliveryEnvelope,
      eventId,
      eventType: String(eventData.eventType || "").trim(),
      sessionId,
      turnScopeId,
      dialogProcessId: String(eventData.dialogProcessId || "").trim(),
      lifecycleSequence: Number(eventEnvelope?.ordering?.sequence || 0),
      transportSequence: Number(envelope?.sequence || 0),
      queueKey,
      attempts: 0,
      timer: null,
    };
    pendingDeliveries.set(eventId, delivery);
    const queue = targetSocket.__agentProxyLifecycleDeliveryQueues.get(queueKey) || [];
    queue.push(delivery);
    targetSocket.__agentProxyLifecycleDeliveryQueues.set(queueKey, queue);
    if (queue[0] !== delivery) {
      return { result: "queued", reason: "waiting_for_prior_receipt" };
    }
    return this._deliverPendingLifecycle(targetSocket, delivery);
  }

  projectChannelEventForDelivery(channel, envelope) {
    if (!channel || !envelope) return envelope;
    const channelSessionId = String(this._extractSessionIdFromChannelKey(channel.key) || "").trim();
    return createAgentTransportEvent({
      event: envelope.event,
      data: envelope.data,
      channelSessionId,
    });
  }

  _deliverPendingLifecycle(targetSocket, delivery) {
    delivery.attempts += 1;
    const sendResult = this.sendSocketEvent(targetSocket, delivery.envelope);
    if (sendResult.result !== "sent") {
      this._removePendingLifecycleDelivery(targetSocket, delivery);
      return sendResult;
    }
    if (targetSocket.__agentProxyPendingLifecycleDeliveries?.get(delivery.eventId) !== delivery) {
      return sendResult;
    }
    delivery.timer = setTimeout(
      () => this._retryPendingLifecycleDelivery(targetSocket, delivery.eventId),
      config.turnLifecycleReceiptTimeoutMs,
    );
    delivery.timer.unref?.();
    return sendResult;
  }

  _removePendingLifecycleDelivery(targetSocket, delivery) {
    if (!delivery) return;
    if (delivery.timer) clearTimeout(delivery.timer);
    targetSocket?.__agentProxyPendingLifecycleDeliveries?.delete(delivery.eventId);
    const queues = targetSocket?.__agentProxyLifecycleDeliveryQueues;
    const queue = queues instanceof Map ? queues.get(delivery.queueKey) : null;
    if (!queue) return;
    const index = queue.indexOf(delivery);
    if (index >= 0) queue.splice(index, 1);
    if (!queue.length) queues.delete(delivery.queueKey);
  }

  _retryPendingLifecycleDelivery(targetSocket, eventId = "") {
    const delivery = targetSocket?.__agentProxyPendingLifecycleDeliveries?.get(eventId);
    if (!delivery) return false;
    if (delivery.timer) {
      clearTimeout(delivery.timer);
      delivery.timer = null;
    }
    if (delivery.attempts >= config.turnLifecycleDeliveryMaxAttempts) {
      this.logSessionEvent(delivery.channel, {
        category: "transport",
        level: "error",
        event: "agentProxy.channel.lifecycleReceipt.exhausted",
        sessionId: delivery.sessionId,
        dialogProcessId: delivery.dialogProcessId,
        turnScopeId: delivery.turnScopeId,
        data: {
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          lifecycleSequence: delivery.lifecycleSequence,
          transportSequence: delivery.transportSequence,
          attempts: delivery.attempts,
          connectionId: ensureConnectionId(targetSocket),
        },
      });
      this.clearPendingLifecycleDeliveries(targetSocket);
      try {
        targetSocket.close(1011, "lifecycle_receipt_timeout");
      } catch {}
      return false;
    }
    if (TERMINAL_TURN_EVENTS.has(delivery.eventType)) {
      this.logSessionEvent(delivery.channel, {
        category: "transport",
        level: "warn",
        event: "agentProxy.channel.terminalLifecycle.receiptTimeout",
        sessionId: delivery.sessionId,
        dialogProcessId: delivery.dialogProcessId,
        turnScopeId: delivery.turnScopeId,
        data: {
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          lifecycleSequence: delivery.lifecycleSequence,
          transportSequence: delivery.transportSequence,
          attempt: delivery.attempts,
          connectionId: ensureConnectionId(targetSocket),
        },
      });
    }
    return this._deliverPendingLifecycle(targetSocket, delivery).result === "sent";
  }

  replayChannelEvents(channel, targetSocket, lastSequence = 0) {
    if (!channel || !targetSocket) return;
    const expectedSequence = Math.max(0, Number(lastSequence || 0));
    const replayEvents = channel.eventLog.filter(
      (eventEnvelope) => Number(eventEnvelope?.sequence || 0) > expectedSequence,
    );
    for (const eventEnvelope of replayEvents) {
      const sendResult = this.sendChannelEvent(channel, targetSocket, eventEnvelope);
      if (
        !isAcceptedChannelDelivery(sendResult) ||
        eventEnvelope.event === TURN_LIFECYCLE_WIRE_EVENT
      ) {
        continue;
      }
      targetSocket.__agentProxyLastSequenceByChannel ||= {};
      targetSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
        eventEnvelope?.sequence || 0,
      );
    }
  }

  syncSocketToChannelTail(channel, targetSocket) {
    if (!channel || !targetSocket) return;
    targetSocket.__agentProxyLastSequenceByChannel =
      targetSocket.__agentProxyLastSequenceByChannel || {};
    targetSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
      channel?.eventSequence || 0,
    );
  }

  broadcastChannelEvent(channel, envelope) {
    if (!channel || !envelope) return;
    const eventData = envelope?.data || {};
    const lifecycle = eventData?.payload || {};
    const terminalLifecycle =
      envelope?.event === TURN_LIFECYCLE_WIRE_EVENT &&
      TERMINAL_TURN_EVENTS.has(String(lifecycle?.eventType || "").trim());
    if (!channel.subscribers.size && terminalLifecycle) {
      this.logSessionEvent(channel, {
        category: "transport",
        level: "warn",
        event: "agentProxy.channel.terminalLifecycle.deliveryDeferred",
        sessionId: eventData?.identity?.sessionId,
        dialogProcessId: lifecycle.dialogProcessId,
        turnScopeId: eventData?.identity?.turnScopeId,
        data: {
          channelKey: channel.key,
          eventId: String(eventData?.identity?.eventId || "").trim(),
          eventType: String(lifecycle.eventType || "").trim(),
          sequence: Number(eventData?.ordering?.sequence || 0),
          reason: "no_subscriber",
        },
      });
    }
    this.recordSuccessfulDataPlaneOperation("broadcasts");
    for (const subscriberSocket of channel.subscribers) {
      const reconnectTransaction = subscriberSocket.__agentProxyReconnectTransaction;
      if (Array.isArray(reconnectTransaction?.eventBuffer)) {
        reconnectTransaction.eventBuffer.push({
          channelKey: channel.key,
          sequence: Number(envelope?.sequence || 0),
          envelope,
        });
        if (terminalLifecycle) {
          this.logSessionEvent(channel, {
            category: "transport",
            event: "agentProxy.channel.terminalLifecycle.delivery",
            sessionId: eventData?.identity?.sessionId,
            dialogProcessId: lifecycle.dialogProcessId,
            turnScopeId: eventData?.identity?.turnScopeId,
            data: {
              channelKey: channel.key,
              connectionId: ensureConnectionId(subscriberSocket),
              eventId: String(eventData?.identity?.eventId || "").trim(),
              eventType: String(lifecycle.eventType || "").trim(),
              lifecycleSequence: Number(eventData?.ordering?.sequence || 0),
              transportSequence: Number(envelope?.sequence || 0),
              result: "buffered_for_reconnect",
            },
          });
        }
        continue;
      }
      const connectionId = ensureConnectionId(subscriberSocket);
      const sendResult = this.sendChannelEvent(channel, subscriberSocket, envelope);
      const deliveryAccepted = isAcceptedChannelDelivery(sendResult);
      if (terminalLifecycle) {
        this.logSessionEvent(channel, {
          category: "transport",
          level: deliveryAccepted ? "info" : "warn",
          event: "agentProxy.channel.terminalLifecycle.delivery",
          sessionId: eventData?.identity?.sessionId,
          dialogProcessId: lifecycle.dialogProcessId,
          turnScopeId: eventData?.identity?.turnScopeId,
          data: {
            channelKey: channel.key,
            connectionId,
            eventId: String(eventData?.identity?.eventId || "").trim(),
            eventType: String(lifecycle.eventType || "").trim(),
            lifecycleSequence: Number(eventData?.ordering?.sequence || 0),
            transportSequence: Number(envelope?.sequence || 0),
            bufferedAmount: Number(subscriberSocket.bufferedAmount || 0),
            result: sendResult.result,
            reason: sendResult.reason,
          },
        });
      }
      if (!deliveryAccepted) {
        this.logSessionEvent(channel, {
          category: "transport",
          level: "warn",
          event: "agentProxy.channel.broadcast.delivery",
          data: {
            channelKey: channel.key,
            connectionId,
            result: sendResult.result,
            dropReason: sendResult.reason,
            ...resolveMessageEventTrace(envelope?.event, eventData, envelope?.sequence),
          },
        });
      }
      if (!deliveryAccepted) continue;
      this.recordSuccessfulDataPlaneOperation("deliveries");
      if (envelope?.event === TURN_LIFECYCLE_WIRE_EVENT) continue;
      subscriberSocket.__agentProxyLastSequenceByChannel =
        subscriberSocket.__agentProxyLastSequenceByChannel || {};
      subscriberSocket.__agentProxyLastSequenceByChannel[channel.key] = Number(
        envelope?.sequence || 0,
      );
    }
  }

  broadcastChannelState(channel, stateItem = {}) {
    if (!channel || !stateItem) return;
    this.broadcastChannelEvent(channel, {
      sequence: Number(channel?.eventSequence || 0),
      event: AGENT_TRANSPORT_EVENT.CHANNEL_STATE,
      data: this._buildConversationStatePayload(channel, stateItem, {
        updatedAtMs: Number(stateItem?.updatedAtMs || nowMs()),
      }),
    });
  }

  sendChannelStateSnapshot(channel, targetSocket) {
    if (!channel || !targetSocket) return;
    for (const envelope of this.buildChannelStateSnapshot(channel)) {
      this.sendSocketEvent(targetSocket, envelope);
    }
  }

  buildChannelStateSnapshot(channel) {
    if (!channel) return [];
    const stateList = Array.from(channel.conversationStateByDialogProcessId.values()).sort(
      (left, right) => Number(left?.updatedAtMs || 0) - Number(right?.updatedAtMs || 0),
    );
    return stateList.map((stateItem) => ({
      event: AGENT_TRANSPORT_EVENT.CHANNEL_STATE,
      data: this._buildConversationStatePayload(channel, stateItem, {
        updatedAtMs: Number(stateItem?.updatedAtMs || 0),
      }),
    }));
  }

  _buildConversationStatePayload(channel, stateItem = {}, overrides = {}) {
    const state = String(stateItem?.state || "").trim();
    const dialogProcessId = String(stateItem?.dialogProcessId || "").trim();
    const createdAtMs = Number(stateItem?.createdAtMs || stateItem?.updatedAtMs || nowMs());
    const updatedAtMs = Number(overrides?.updatedAtMs ?? stateItem?.updatedAtMs ?? nowMs());
    return {
      sessionId: String(stateItem?.sessionId || ""),
      dialogProcessId,
      turnScopeId: String(stateItem?.turnScopeId || "").trim(),
      state,
      sourceEvent: String(stateItem?.sourceEvent || ""),
      seq: Number(stateItem?.seq || 0),
      createdAtMs,
      createdAt: new Date(createdAtMs).toISOString(),
      updatedAtMs,
      ...(String(stateItem?.requestId || "").trim()
        ? { requestId: String(stateItem.requestId).trim() }
        : {}),
    };
  }

  sendSocketEvent(targetSocket, envelope) {
    if (!targetSocket) return { result: "skipped", reason: "socket_missing" };
    if (!envelope) return { result: "skipped", reason: "envelope_missing" };
    if (targetSocket.readyState !== this.WebSocket.OPEN) {
      return { result: "skipped", reason: "socket_not_open" };
    }
    if (Number(targetSocket.bufferedAmount || 0) > config.wsMaxBufferedBytes) {
      try {
        targetSocket.close(1008, "slow_consumer");
      } catch {}
      return { result: "skipped", reason: "backpressure_limit" };
    }
    try {
      targetSocket.send(
        JSON.stringify({
          event: envelope.event,
          data: envelope.data,
          ...(String(envelope.channelSessionId || "").trim()
            ? { channelSessionId: String(envelope.channelSessionId).trim() }
            : {}),
        }),
      );
      return { result: "sent", reason: "" };
    } catch (error) {
      return {
        result: "failed",
        reason: String(error?.name || "send_error").trim() || "send_error",
      };
    }
  }

  sendSocketError(targetSocket, errorMessage = "") {
    const localizedError = localizeAgentProxyMessage(
      String(errorMessage || ""),
      String(targetSocket?.__agentProxyLocale || "").trim(),
    );
    this.sendSocketEvent(targetSocket, {
      event: AGENT_TRANSPORT_EVENT.ERROR,
      data: createAgentTransportError({
        code: "AGENT_PROXY_ERROR",
        message: String(localizedError || AGENT_PROXY_ERROR.DEFAULT).trim() || AGENT_PROXY_ERROR.DEFAULT,
        identity: {
          sessionId: targetSocket?.__agentProxySessionId,
          turnScopeId: targetSocket?.__agentProxyTurnScopeId,
        },
      }),
    });
  }
}

export const subscriberbroadcastMethods = Object.getOwnPropertyDescriptors(
  SubscriberBroadcastMethods.prototype,
);
delete subscriberbroadcastMethods.constructor;
