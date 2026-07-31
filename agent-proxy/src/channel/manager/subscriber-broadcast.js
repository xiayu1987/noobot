/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
  CONVERSATION_STATE,
} from "../../shared/constants.js";
import { config } from "../../shared/config.js";
import { ensureConnectionId, nowMs, resolveMessageEventTrace } from "../../shared/utils.js";
import { localizeAgentProxyMessage } from "noobot-i18n/agent-proxy";

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


_withChannelSessionScope(channel, envelope = {}) {
  if (!channel || !envelope?.data || typeof envelope.data !== "object") {
    return envelope;
  }
  const existingSessionId = String(envelope?.data?.sessionId || "").trim();
  const channelSessionId = this._extractSessionIdFromChannelKey?.(channel.key);
  if (!channelSessionId || existingSessionId) return envelope;
  return {
    ...envelope,
    data: {
      ...(channelSessionId && !existingSessionId ? { sessionId: channelSessionId } : {}),
      ...envelope.data,
    },
  };
}

replayChannelEvents(channel, targetSocket, lastSequence = 0) {
  if (!channel || !targetSocket) return;
  const expectedSequence = Math.max(0, Number(lastSequence || 0));
  const replayEvents = channel.eventLog.filter(
    (eventEnvelope) => Number(eventEnvelope?.sequence || 0) > expectedSequence,
  );
  for (const eventEnvelope of replayEvents) {
    this.sendSocketEvent(targetSocket, this._withChannelSessionScope(channel, eventEnvelope));
  }
  targetSocket.__agentProxyLastSequenceByChannel =
    targetSocket.__agentProxyLastSequenceByChannel || {};
  targetSocket.__agentProxyLastSequenceByChannel[channel.key] = channel.eventSequence;
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
  const scopedEnvelope = this._withChannelSessionScope(channel, envelope);
  const eventData = scopedEnvelope?.data || {};
  this.recordSuccessfulDataPlaneOperation("broadcasts");
  for (const subscriberSocket of channel.subscribers) {
    const reconnectTransaction = subscriberSocket.__agentProxyReconnectTransaction;
    if (Array.isArray(reconnectTransaction?.eventBuffer)) {
      reconnectTransaction.eventBuffer.push({
        channelKey: channel.key,
        sequence: Number(envelope?.sequence || 0),
        envelope: scopedEnvelope,
      });
      continue;
    }
    const connectionId = ensureConnectionId(subscriberSocket);
    const sendResult = this.sendSocketEvent(subscriberSocket, scopedEnvelope);
    if (sendResult.result !== "sent") {
      this.logSessionEvent(channel, {
        category: "transport",
        level: "warn",
        event: "agentProxy.channel.broadcast.delivery",
        data: {
          channelKey: channel.key,
          connectionId,
          result: sendResult.result,
          dropReason: sendResult.reason,
          ...resolveMessageEventTrace(scopedEnvelope?.event, eventData, scopedEnvelope?.sequence),
        },
      });
    }
    if (sendResult.result !== "sent") continue;
    this.recordSuccessfulDataPlaneOperation("deliveries");
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
    event: CHANNEL_EVENT.CHANNEL_STATE,
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
    (left, right) =>
      Number(left?.updatedAtMs || 0) - Number(right?.updatedAtMs || 0),
  );
  return stateList.map((stateItem) => ({
      event: CHANNEL_EVENT.CHANNEL_STATE,
      data: this._buildConversationStatePayload(channel, stateItem, {
        updatedAtMs: Number(stateItem?.updatedAtMs || 0),
      }),
    }));
}

_findPendingInteractionsByDialogProcessId(channel, dialogProcessId = "") {
  if (!channel?.pendingInteractionRequests?.size) return [];
  const normalizedDpId = String(dialogProcessId || "").trim();
  if (!normalizedDpId) return [];
  const pendingInteractions = [];
  for (const envelope of channel.pendingInteractionRequests.values()) {
    const envelopeDpId = String(envelope?.data?.dialogProcessId || "").trim();
    if (!envelopeDpId || envelopeDpId !== normalizedDpId) continue;
    const sequence = Number(envelope?.data?.seq || envelope?.sequence || 0);
    if (!envelope?.data || typeof envelope.data !== "object") continue;
    pendingInteractions.push({
      ...envelope.data,
      __agentProxySequence: sequence,
    });
  }
  return pendingInteractions.sort(
    (left, right) =>
      Number(left?.__agentProxySequence || 0) - Number(right?.__agentProxySequence || 0),
  );
}

_findLatestPendingInteractionByDialogProcessId(channel, dialogProcessId = "") {
  const pendingInteractions = this._findPendingInteractionsByDialogProcessId(
    channel,
    dialogProcessId,
  );
  return pendingInteractions[pendingInteractions.length - 1] || null;
}

_buildConversationStatePayload(channel, stateItem = {}, overrides = {}) {
  const state = String(stateItem?.state || "").trim();
  const dialogProcessId = String(stateItem?.dialogProcessId || "").trim();
  const createdAtMs = Number(stateItem?.createdAtMs || stateItem?.updatedAtMs || nowMs());
  const updatedAtMs = Number(overrides?.updatedAtMs ?? stateItem?.updatedAtMs ?? nowMs());
  const pendingInteractions =
    state === CONVERSATION_STATE.INTERACTION_PENDING
      ? this._findPendingInteractionsByDialogProcessId(channel, dialogProcessId)
      : [];
  const firstPendingInteraction = pendingInteractions[0] || null;
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
    ...(pendingInteractions.length
      ? {
          pendingInteraction: firstPendingInteraction,
          pendingInteractions,
          pendingRequestIds: pendingInteractions
            .map((item) => String(item?.requestId || "").trim())
            .filter(Boolean),
        }
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
    try { targetSocket.close(1008, "slow_consumer"); } catch {}
    return { result: "skipped", reason: "backpressure_limit" };
  }
  try {
    targetSocket.send(
      JSON.stringify({
        event: envelope.event,
        data: envelope.data,
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
    event: CHANNEL_EVENT.ERROR,
    data: {
      error: String(localizedError || AGENT_PROXY_ERROR.DEFAULT).trim() ||
        AGENT_PROXY_ERROR.DEFAULT,
    },
  });
}
}

export const subscriberbroadcastMethods = Object.getOwnPropertyDescriptors(SubscriberBroadcastMethods.prototype);
delete subscriberbroadcastMethods.constructor;
