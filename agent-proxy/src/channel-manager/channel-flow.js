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
import { writeAgentProxyRouteDebugEvent } from "../route-debug-runtime-events.js";

class ChannelFlowMethods {
// ---- Channel Resolution ----

resolveChannelFromSocketMessage(socket, payload = {}) {
  const action = String(payload?.action || "").trim().toLowerCase();
  if (action === WS_ACTION.INTERACTION_RESPONSE) {
    const channel = this.getChannelByRequestId(payload?.requestId);
    if (channel) {
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.matched", payload, socket, channel, data: { routeSource: "request_id" } });
      return channel;
    }
  }
  const sessionId = String(payload?.sessionId || "").trim();
  const explicitChannelKey = String(payload?.channelKey || "").trim();
  if (explicitChannelKey && this.hasChannel(explicitChannelKey)) {
    if (sessionId && this._extractSessionIdFromChannelKey?.(explicitChannelKey) !== sessionId) {
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.rejected", payload, socket, data: { reason: "explicit_channel_session_mismatch", explicitChannelKey } });
      return null;
    }
    const channel = this.getChannel(explicitChannelKey);
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.matched", payload, socket, channel, data: { routeSource: "explicit_channel_key" } });
    return channel;
  }
  const userId = String(payload?.userId || socket?.__agentProxyUserId || "").trim();
  if (sessionId && userId) {
    const constructedKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: payload?.parentSessionId,
      parentDialogProcessId: payload?.parentDialogProcessId,
    });
    if (this.hasChannel(constructedKey)) {
      const channel = this.getChannel(constructedKey);
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.matched", payload, socket, channel, data: { routeSource: "constructed_key", usedSocketUserId: !payload?.userId && Boolean(socket?.__agentProxyUserId) } });
      return channel;
    }
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.missed", payload, socket, data: { routeSource: "constructed_key", usedSocketUserId: !payload?.userId && Boolean(socket?.__agentProxyUserId) } });
  }
  const activeChannelKey = String(socket?.__agentProxyActiveChannelKey || "").trim();
  if (activeChannelKey && this.hasChannel(activeChannelKey)) {
    if (sessionId && this._extractSessionIdFromChannelKey?.(activeChannelKey) !== sessionId) {
      void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.rejected", payload, socket, data: { reason: "active_channel_session_mismatch", activeChannelKey } });
      return null;
    }
    const channel = this.getChannel(activeChannelKey);
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.matched", payload, socket, channel, data: { routeSource: "active_channel" } });
    return channel;
  }
  void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.resolve.notFound", payload, socket, data: { reason: "no_matching_channel", hasSessionId: Boolean(sessionId), hasUserId: Boolean(userId), hasActiveChannelKey: Boolean(activeChannelKey), hasExplicitChannelKey: Boolean(explicitChannelKey) } });
  return null;
}

// ---- Forward ----

forwardToUpstream(channel, payload = {}) {
  if (!channel?.upstreamSocket || channel.upstreamSocket.readyState !== this.WebSocket.OPEN) {
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forward.skipped", payload, channel, data: { reason: "upstream_not_open" } });
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.forward.skipped",
      data: { channelKey: channel?.key, action: payload?.action || "message", reason: "upstream_not_open" },
    });
    return false;
  }
  try {
    channel.upstreamSocket.send(JSON.stringify(payload || {}));
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forward.sent", payload, channel, data: { reason: "forwarded" } });
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.forward",
      data: {
        channelKey: channel.key,
        action: payload?.action || "message",
        sessionId: payload?.sessionId,
        dialogProcessId: payload?.dialogProcessId,
        turnScopeId: payload?.turnScopeId,
        requestId: payload?.requestId,
      },
    });
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
        const turnScopeId = String(requestEnvelope?.data?.turnScopeId || "").trim();
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
          turnScopeId,
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
  } catch (error) {
    void writeAgentProxyRouteDebugEvent({ event: "agentProxy.route.forward.error", payload, channel, data: { reason: "send_error", errorMessage: String(error?.message || error || "send failed").slice(0, 300) } });
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.forward.error",
      data: { channelKey: channel.key, action: payload?.action || "message", error: String(error?.message || error || "send failed") },
    });
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
  const hasReusableUpstream =
    channel?.upstreamSocket?.readyState === this.WebSocket.OPEN;
  const isActiveChannelStatus =
    channel.status === CHANNEL_STATUS.RUNNING ||
    channel.status === CHANNEL_STATUS.CONNECTING;
  const keepExistingRun = isActiveChannelStatus && hasReusableUpstream;
  const shouldStartNewRun = !keepExistingRun;

  this.attachSubscriber(channel, socket);
  this.syncSocketToChannelTail(channel, socket);
  this.logSessionEvent(channel, {
    category: "interaction",
    event: shouldStartNewRun ? "agentProxy.channel.start" : "agentProxy.channel.join",
    data: {
      channelKey: channel.key,
      socketId: socket?.__agentProxySocketId,
      keepExistingRun,
      sessionId,
      userId,
      channelStatus: channel.status,
      hasReusableUpstream,
      upstreamReadyState: channel?.upstreamSocket?.readyState,
    },
  });

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
  if (isActiveChannelStatus && !hasReusableUpstream) {
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.startOrJoin.restartStaleUpstream",
      payload,
      socket,
      channel,
      data: {
        reason: "active_channel_without_open_upstream",
        previousStatus: channel.status,
        upstreamReadyState: channel?.upstreamSocket?.readyState,
      },
    });
  }
  this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
  this.connectUpstreamChannel(channel, normalizedConnectionApiKey, String(connectionLocale || "").trim());
}
}

export const channelflowMethods = Object.getOwnPropertyDescriptors(ChannelFlowMethods.prototype);
delete channelflowMethods.constructor;
