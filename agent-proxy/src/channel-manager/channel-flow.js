import {
  AGENT_PROXY_ERROR,
  CHANNEL_STATUS,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  UPSTREAM_CLOSE_REASON,
  WS_ACTION,
} from "../constants.js";
import { normalizeApiKey, createChannelKey, buildFingerprint } from "../utils.js";

class ChannelFlowMethods {
// ---- Channel Resolution ----

resolveChannelFromSocketMessage(socket, payload = {}) {
  const action = String(payload?.action || "").trim().toLowerCase();
  if (action === WS_ACTION.INTERACTION_RESPONSE) {
    const channel = this.getChannelByRequestId(payload?.requestId);
    if (channel) return channel;
  }
  const explicitChannelKey = String(payload?.channelKey || "").trim();
  if (explicitChannelKey && this.hasChannel(explicitChannelKey)) {
    return this.getChannel(explicitChannelKey);
  }
  const sessionId = String(payload?.sessionId || "").trim();
  const userId = String(payload?.userId || "").trim();
  if (sessionId && userId) {
    const constructedKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: payload?.parentSessionId,
      parentDialogProcessId: payload?.parentDialogProcessId,
    });
    if (this.hasChannel(constructedKey)) return this.getChannel(constructedKey);
  }
  const activeChannelKey = String(socket?.__agentProxyActiveChannelKey || "").trim();
  if (activeChannelKey && this.hasChannel(activeChannelKey)) {
    return this.getChannel(activeChannelKey);
  }
  return null;
}

// ---- Forward ----

forwardToUpstream(channel, payload = {}) {
  if (!channel?.upstreamSocket || channel.upstreamSocket.readyState !== this.WebSocket.OPEN) {
    return false;
  }
  try {
    channel.upstreamSocket.send(JSON.stringify(payload || {}));
    if (
      String(payload?.action || "").trim().toLowerCase() ===
      WS_ACTION.INTERACTION_RESPONSE
    ) {
      const requestId = String(payload?.requestId || "").trim();
      if (requestId) {
        const requestEnvelope = channel.pendingInteractionRequests.get(requestId) || null;
        channel.pendingInteractionRequests.delete(requestId);
        this.requestChannelMap.delete(requestId);
        const dialogProcessId = String(requestEnvelope?.data?.dialogProcessId || "").trim();
        const clientTurnId = String(requestEnvelope?.data?.clientTurnId || "").trim();
        const sessionId = String(requestEnvelope?.data?.sessionId || "").trim();
        const remainingPendingInteractions = this._findPendingInteractionsByDialogProcessId(
          channel,
          dialogProcessId,
        );
        const stateKey = dialogProcessId || CONVERSATION_SCOPE_KEY;
        const previousStateItem =
          channel.conversationStateByDialogProcessId.get(stateKey) || null;
        this.updateConversationState(channel, {
          dialogProcessId,
          clientTurnId,
          sessionId,
          state: remainingPendingInteractions.length
            ? CONVERSATION_STATE.INTERACTION_PENDING
            : CONVERSATION_STATE.SENDING,
          sourceEvent: CONVERSATION_SOURCE_EVENT.INTERACTION_RESPONSE,
          seq:
            Math.max(
              Number(previousStateItem?.seq || 0),
              Number(requestEnvelope?.data?.seq || 0),
              Number(channel?.eventSequence || 0),
            ) + 1,
          requestId,
        });
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ---- Start / Join ----

startOrJoinChannel({ socket, payload, connectionApiKey, connectionLocale }) {
  const normalizedConnectionApiKey = normalizeApiKey(connectionApiKey);
  if (!normalizedConnectionApiKey) {
    this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_APIKEY);
    return;
  }
  const userId = String(payload?.userId || "").trim();
  const sessionId = String(payload?.sessionId || "").trim();
  if (!userId || !sessionId) {
    this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_USERID_SESSIONID);
    return;
  }
  const channelKey = createChannelKey({
    userId,
    sessionId,
    parentSessionId: payload?.parentSessionId,
    parentDialogProcessId: payload?.parentDialogProcessId,
  });
  const channel = this.ensureChannel(channelKey, payload);
  if (!channel) return;
  const identityItem = this.resolveApiKeyIdentity(normalizedConnectionApiKey);
  const requesterUserId =
    String(socket?.__agentProxyUserId || "").trim() ||
    String(identityItem?.userId || "").trim() ||
    String(userId || "").trim();
  if (!channel.ownerApiKey) {
    channel.ownerApiKey = normalizedConnectionApiKey;
  }
  if (!channel.ownerUserId) {
    channel.ownerUserId = requesterUserId;
  }
  if (!this.hasChannelPermission(channel, normalizedConnectionApiKey, requesterUserId)) {
    this.sendSocketError(socket, AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION("start_or_join"));
    return;
  }

  const nextPayloadFingerprint = buildFingerprint(payload);
  const keepExistingRun =
    channel.status === CHANNEL_STATUS.RUNNING ||
    channel.status === CHANNEL_STATUS.CONNECTING;
  const shouldStartNewRun = !keepExistingRun;

  this.attachSubscriber(channel, socket);
  this.syncSocketToChannelTail(channel, socket);

  if (keepExistingRun) return;
  if (!shouldStartNewRun) return;

  channel.startPayload = { ...payload };
  channel.startFingerprint = nextPayloadFingerprint;
  channel.eventLog = [];
  channel.eventSequence = 0;
  channel.conversationStateByDialogProcessId = new Map();
  this.updateConversationState(channel, {
    dialogProcessId: "",
    state: CONVERSATION_STATE.NO_CONVERSATION,
    sourceEvent: CONVERSATION_SOURCE_EVENT.RESTART,
    seq: 0,
  });
  channel.cleanupAfterMs = 0;
  channel.upstreamClosed = false;
  channel._errorHandled = false;
  this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
  this.connectUpstreamChannel(channel, normalizedConnectionApiKey, String(connectionLocale || "").trim());
}
}

export const channelflowMethods = Object.getOwnPropertyDescriptors(ChannelFlowMethods.prototype);
delete channelflowMethods.constructor;
