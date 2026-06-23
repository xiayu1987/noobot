import {
  AGENT_PROXY_ERROR,
  CHANNEL_EVENT,
  CONVERSATION_STATE,
} from "../constants.js";
import { config } from "../config.js";
import { nowMs, isTerminalStatus } from "../utils.js";
import { localizeAgentProxyMessage } from "noobot-i18n/agent-proxy";

class SubscriberBroadcastMethods {
// ---- Subscriber Management ----

attachSubscriber(channel, socket) {
  if (!channel || !socket) return;
  channel.subscribers.add(socket);
  socket.__agentProxyChannelKeys = socket.__agentProxyChannelKeys || new Set();
  socket.__agentProxyChannelKeys.add(channel.key);
  socket.__agentProxyActiveChannelKey = channel.key;
  this.sendChannelStateSnapshot(channel, socket);
}

detachSocketFromAllChannels(socket) {
  if (!socket) return;
  const connectedChannelKeys = socket.__agentProxyChannelKeys || new Set();
  for (const channelKey of connectedChannelKeys) {
    const channel = this.channelStore.get(channelKey);
    if (!channel) continue;
    channel.subscribers.delete(socket);
    channel.updatedAtMs = nowMs();
    if (!channel.subscribers.size && isTerminalStatus(channel.status)) {
      channel.cleanupAfterMs = nowMs() + config.channelRetentionMs;
    }
  }
  socket.__agentProxyChannelKeys = new Set();
  socket.__agentProxyActiveChannelKey = "";
  socket.__agentProxyLastSequenceByChannel = {};
}

// ---- Replay & Broadcast ----

_withChannelSessionScope(channel, envelope = {}) {
  if (!channel || !envelope?.data || typeof envelope.data !== "object") {
    return envelope;
  }
  const existingSessionId = String(envelope?.data?.sessionId || "").trim();
  if (existingSessionId) return envelope;
  const channelSessionId = this._extractSessionIdFromChannelKey?.(channel.key);
  if (!channelSessionId) return envelope;
  return {
    ...envelope,
    data: {
      sessionId: channelSessionId,
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
  for (const subscriberSocket of channel.subscribers) {
    this.sendSocketEvent(subscriberSocket, scopedEnvelope);
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
  const stateList = Array.from(channel.conversationStateByDialogProcessId.values()).sort(
    (left, right) =>
      Number(left?.updatedAtMs || 0) - Number(right?.updatedAtMs || 0),
  );
  for (const stateItem of stateList) {
    this.sendSocketEvent(targetSocket, {
      event: CHANNEL_EVENT.CHANNEL_STATE,
      data: this._buildConversationStatePayload(channel, stateItem, {
        updatedAtMs: Number(stateItem?.updatedAtMs || 0),
      }),
    });
  }
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
  if (!targetSocket || targetSocket.readyState !== this.WebSocket.OPEN || !envelope) return;
  try {
    targetSocket.send(
      JSON.stringify({
        event: envelope.event,
        data: envelope.data,
      }),
    );
  } catch {
    // ignore send errors
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
