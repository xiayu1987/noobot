/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_PROXY_ERROR,
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
  UPSTREAM_CLOSE_REASON,
} from "../../shared/constants.js";
import { normalizeApiKey, createChannelKey, buildFingerprint } from "../../shared/utils.js";
import { writeAgentProxyRouteDebugEvent } from "../../runtime-events/route-debug-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../../runtime-events/agent-transport-debug-runtime-events.js";
import { AGENT_COMMAND, RUN_COMMAND_TYPES } from "@noobot/agent-transport-protocol";

function projectForwardCommandType(payload) {
  const envelope = payload ?? {};
  return envelope.commandType || envelope.action || "message";
}

function projectForwardLogIdentity(payload) {
  const envelope = payload ?? {};
  const identity = envelope.identity ?? {};
  const interaction = envelope.interaction ?? {};
  return {
    commandType: projectForwardCommandType(envelope),
    sessionId: identity.sessionId || envelope.sessionId,
    dialogProcessId: identity.dialogProcessId || envelope.dialogProcessId,
    turnScopeId: identity.turnScopeId || envelope.turnScopeId,
    requestId: interaction.requestId || envelope.requestId,
  };
}

function describeForwardError(error) {
  return String(error?.message || error || "send failed");
}

function projectResolvedInteractionIdentity(resolvedEnvelope) {
  const envelope = resolvedEnvelope ?? {};
  const identity = envelope.identity ?? {};
  const ordering = envelope.ordering ?? {};
  return {
    dialogProcessId: String((envelope.payload ?? {}).dialogProcessId || "").trim(),
    turnScopeId: String(identity.turnScopeId || "").trim(),
    sessionId: String(identity.sessionId || "").trim(),
    sequence: Number(ordering.sequence || 0),
  };
}

function buildInteractionConversationPatch({
  resolved,
  currentState,
  hasRemainingInteraction,
  requestId,
}) {
  const current = currentState ?? {};
  return {
    sessionId: resolved.sessionId || String(current.sessionId || "").trim(),
    dialogProcessId: resolved.dialogProcessId,
    turnScopeId: resolved.turnScopeId || String(current.turnScopeId || "").trim(),
    state: hasRemainingInteraction
      ? CONVERSATION_STATE.INTERACTION_PENDING
      : CONVERSATION_STATE.SENDING,
    sourceEvent: AGENT_COMMAND.INTERACTION_RESPONSE,
    seq: Math.max(Number(current.seq || 0), resolved.sequence),
    createdAtMs: Number(current.createdAtMs || 0),
    requestId,
  };
}

class ChannelFlowMethods {
  resolveChannelFromSocketMessage(socket, payload = {}) {
    const commandType = String(payload?.commandType || "")
      .trim()
      .toLowerCase();
    if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
      const channel = this.getChannelByRequestId(payload?.interaction?.requestId);
      if (channel) {
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.resolve.matched",
          payload,
          socket,
          channel,
          data: { routeSource: "request_id" },
        });
        return channel;
      }
    }
    const identity =
      payload?.identity && typeof payload.identity === "object" ? payload.identity : {};
    const sessionId = String(identity.sessionId || payload?.sessionId || "").trim();
    const explicitChannelKey = String(payload?.channelKey || "").trim();
    if (explicitChannelKey && this.hasChannel(explicitChannelKey)) {
      if (sessionId && this._extractSessionIdFromChannelKey?.(explicitChannelKey) !== sessionId) {
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.resolve.rejected",
          payload,
          socket,
          data: { reason: "explicit_channel_session_mismatch", explicitChannelKey },
        });
        return null;
      }
      const channel = this.getChannel(explicitChannelKey);
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.resolve.matched",
        payload,
        socket,
        channel,
        data: { routeSource: "explicit_channel_key" },
      });
      return channel;
    }
    const userId = String(socket?.__agentProxyUserId || "").trim();
    if (sessionId && userId) {
      const constructedKey = createChannelKey({
        userId,
        sessionId,
        parentSessionId: identity.parentSessionId || payload?.parentSessionId,
        parentDialogProcessId: identity.parentDialogProcessId || payload?.parentDialogProcessId,
      });
      if (this.hasChannel(constructedKey)) {
        const channel = this.getChannel(constructedKey);
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.resolve.matched",
          payload,
          socket,
          channel,
          data: { routeSource: "constructed_key", usedSocketUserId: true },
        });
        return channel;
      }
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.resolve.missed",
        payload,
        socket,
        data: { routeSource: "constructed_key", usedSocketUserId: true },
      });
    }
    const activeChannelKey = String(socket?.__agentProxyActiveChannelKey || "").trim();
    if (activeChannelKey && this.hasChannel(activeChannelKey)) {
      if (sessionId && this._extractSessionIdFromChannelKey?.(activeChannelKey) !== sessionId) {
        void writeAgentProxyRouteDebugEvent({
          event: "agentProxy.route.resolve.rejected",
          payload,
          socket,
          data: { reason: "active_channel_session_mismatch", activeChannelKey },
        });
        return null;
      }
      const channel = this.getChannel(activeChannelKey);
      void writeAgentProxyRouteDebugEvent({
        event: "agentProxy.route.resolve.matched",
        payload,
        socket,
        channel,
        data: { routeSource: "active_channel" },
      });
      return channel;
    }
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.resolve.notFound",
      payload,
      socket,
      data: {
        reason: "no_matching_channel",
        hasSessionId: Boolean(sessionId),
        hasUserId: Boolean(userId),
        hasActiveChannelKey: Boolean(activeChannelKey),
        hasExplicitChannelKey: Boolean(explicitChannelKey),
      },
    });
    return null;
  }

  logForwardSkipped(channel, payload = {}) {
    void writeAgentTransportDebugEvent({
      event: "agentProxy.agentTransport.forwardFailed",
      command: payload,
      channel,
      data: { forwarded: false, reason: "upstream_not_open" },
    });
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forward.skipped",
      payload,
      channel,
      data: { reason: "upstream_not_open" },
    });
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.forward.skipped",
      data: {
        channelKey: channel?.key,
        commandType: payload?.commandType || "message",
        reason: "upstream_not_open",
      },
    });
  }

  logForwardSent(channel, payload = {}) {
    void writeAgentTransportDebugEvent({
      event: "agentProxy.agentTransport.commandForwarded",
      command: payload,
      channel,
      data: { forwarded: true, transport: "websocket" },
    });
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forward.sent",
      payload,
      channel,
      data: { reason: "forwarded" },
    });
    this.logSessionEvent(channel, {
      category: "transport",
      event: "agentProxy.upstream.forward",
      data: {
        channelKey: channel.key,
        ...projectForwardLogIdentity(payload),
      },
    });
  }

  logForwardError(channel, payload = {}, error) {
    void writeAgentTransportDebugEvent({
      event: "agentProxy.agentTransport.forwardFailed",
      command: payload,
      channel,
      data: {
        forwarded: false,
        reason: "send_error",
        errorType: String(error?.name || "Error"),
        errorCode: String(error?.code || ""),
      },
    });
    void writeAgentProxyRouteDebugEvent({
      event: "agentProxy.route.forward.error",
      payload,
      channel,
      data: {
        reason: "send_error",
        errorMessage: describeForwardError(error).slice(0, 300),
      },
    });
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.forward.error",
      data: {
        channelKey: channel.key,
        commandType: projectForwardCommandType(payload),
        error: describeForwardError(error),
      },
    });
  }

  settleForwardedInteractionResponse(channel, payload = {}) {
    const requestId = String((payload?.interaction ?? {}).requestId || "").trim();
    if (!requestId) return;
    const resolvedEnvelope = channel.pendingInteractionRequests.get(requestId) || null;
    channel.pendingInteractionRequests.delete(requestId);
    this.requestChannelMap.delete(requestId);
    if (!resolvedEnvelope) return;
    const resolved = projectResolvedInteractionIdentity(resolvedEnvelope);
    const stateKey = resolved.dialogProcessId || CONVERSATION_SCOPE_KEY;
    const currentState = channel.conversationStateByDialogProcessId.get(stateKey) || null;
    const hasRemainingInteraction = Array.from(channel.pendingInteractionRequests.values()).some(
      (envelope) =>
        String((envelope?.payload ?? {}).dialogProcessId || "").trim() === resolved.dialogProcessId,
    );
    this.updateConversationState(
      channel,
      buildInteractionConversationPatch({
        resolved,
        currentState,
        hasRemainingInteraction,
        requestId,
      }),
    );
  }

  forwardToUpstream(channel, payload = {}) {
    if (!channel?.upstreamSocket || channel.upstreamSocket.readyState !== this.WebSocket.OPEN) {
      this.logForwardSkipped(channel, payload);
      return false;
    }
    const commandType = String(payload?.commandType || "")
      .trim()
      .toLowerCase();
    try {
      channel.upstreamSocket.send(JSON.stringify(payload || {}));
      if (RUN_COMMAND_TYPES.includes(commandType)) channel.transport.claimPurpose("run");
      this.logForwardSent(channel, payload);
      if (commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
        this.settleForwardedInteractionResponse(channel, payload);
      }
      return true;
    } catch (error) {
      this.logForwardError(channel, payload, error);
      return false;
    }
  }

  startOrJoinChannel({ socket, payload, connectionApiKey, connectionLocale }) {
    const normalizedConnectionApiKey = normalizeApiKey(connectionApiKey);
    if (!normalizedConnectionApiKey) {
      this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_APIKEY);
      return;
    }
    const identity =
      payload?.identity && typeof payload.identity === "object" ? payload.identity : {};
    const identityItem = this.resolveApiKeyIdentity(normalizedConnectionApiKey);
    const userId = String(socket?.__agentProxyUserId || identityItem?.userId || "").trim();
    const sessionId = String(identity.sessionId || "").trim();
    if (!userId || !sessionId) {
      this.sendSocketError(socket, AGENT_PROXY_ERROR.REQUIRES_USERID_SESSIONID);
      return;
    }
    const channelKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: identity.parentSessionId,
      parentDialogProcessId: identity.parentDialogProcessId,
    });
    const channel = this.ensureChannel(channelKey, payload);
    if (!channel) return;
    const requesterUserId =
      String(socket?.__agentProxyUserId || "").trim() || String(identityItem?.userId || "").trim();
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
    const hasReusableUpstream = channel?.transport?.socket?.readyState === this.WebSocket.OPEN;
    const isActiveChannelStatus =
      channel.activity.phase === CHANNEL_STATUS.RUNNING ||
      channel.transport.phase === CHANNEL_STATUS.CONNECTING ||
      channel.pendingInteractionRequests.size > 0;
    const keepExistingRun = isActiveChannelStatus && hasReusableUpstream;
    const shouldStartNewRun = !keepExistingRun;

    this.attachSubscriber(channel, socket);
    if (keepExistingRun) {
      const sequenceByChannel = socket.__agentProxyLastSequenceByChannel || {};
      this.replayChannelEvents(channel, socket, Number(sequenceByChannel[channel.key] || 0));
    } else {
      this.syncSocketToChannelTail(channel, socket);
    }
    this.logSessionEvent(channel, {
      category: "interaction",
      event: shouldStartNewRun ? "agentProxy.channel.start" : "agentProxy.channel.join",
      data: {
        channelKey: channel.key,
        socketId: socket?.__agentProxySocketId,
        keepExistingRun,
        sessionId,
        userId,
        channelActivityPhase: channel.activity.phase,
        channelTransportPhase: channel.transport.phase,
        hasReusableUpstream,
        upstreamReadyState: channel?.upstreamSocket?.readyState,
      },
    });

    if (keepExistingRun) return;
    if (!shouldStartNewRun) return;

    channel.startPayload = { ...payload };
    channel.startFingerprint = nextPayloadFingerprint;
    const previousActivityPhase = channel.activity.phase;
    const previousTransportPhase = channel.transport.phase;
    channel.eventJournal.reset();
    channel.conversationStateByDialogProcessId = new Map();
    this.updateConversationState(channel, {
      dialogProcessId: "",
      state: CONVERSATION_STATE.NO_CONVERSATION,
      sourceEvent: CONVERSATION_SOURCE_EVENT.RESTART,
      seq: 0,
    });
    channel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
    channel.retention.terminalStatus = "";
    channel.retention.cleanupAfterMs = 0;
    channel.activity.phase = CHANNEL_STATUS.IDLE;
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
          previousActivityPhase,
          previousTransportPhase,
          upstreamReadyState: channel?.upstreamSocket?.readyState,
        },
      });
    }
    this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
    this.connectUpstreamChannel(
      channel,
      normalizedConnectionApiKey,
      String(connectionLocale || "").trim(),
    );
  }
}

export const channelflowMethods = Object.getOwnPropertyDescriptors(ChannelFlowMethods.prototype);
delete channelflowMethods.constructor;
