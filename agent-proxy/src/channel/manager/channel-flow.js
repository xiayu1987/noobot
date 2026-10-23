/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CHANNEL_ACTIVITY_PHASE,
  UPSTREAM_TRANSPORT_PHASE,
  CONVERSATION_SOURCE_EVENT,
  UPSTREAM_CLOSE_REASON,
} from "../../shared/constants.js";
import { createChannelKey, buildFingerprint } from "../../shared/utils.js";
import { writeAgentProxyRouteDebugEvent } from "../../runtime-events/route-debug-runtime-events.js";
import { writeAgentTransportDebugEvent } from "../../runtime-events/agent-transport-debug-runtime-events.js";
import {
  AGENT_CHANNEL_STATE,
  AGENT_CHANNEL_STATE_SCOPE,
  AGENT_COMMAND,
  RUN_COMMAND_TYPES,
} from "@noobot/agent-transport-protocol";
import { text } from "@noobot/shared/value";

function projectForwardLogIdentity(payload) {
  const envelope = payload ?? {};
  const identity = envelope.identity ?? {};
  const interaction = envelope.interaction ?? {};
  return {
    commandType: envelope.commandType,
    sessionId: identity.sessionId,
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    requestId: interaction.requestId,
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
    dialogProcessId: text((envelope.payload ?? {}).dialogProcessId),
    turnScopeId: text(identity.turnScopeId),
    sessionId: text(identity.sessionId),
    sequence: Number(ordering.sequence || 0),
  };
}

function buildInteractionConversationPatch({ resolved, hasRemainingInteraction, requestId }) {
  return {
    scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
    sessionId: resolved.sessionId,
    dialogProcessId: resolved.dialogProcessId,
    turnScopeId: resolved.turnScopeId,
    state: hasRemainingInteraction
      ? AGENT_CHANNEL_STATE.INTERACTION_PENDING
      : AGENT_CHANNEL_STATE.SENDING,
    sourceEvent: AGENT_COMMAND.INTERACTION_RESPONSE,
    seq: resolved.sequence,
    requestId,
  };
}

class ChannelFlowMethods {
  resolveChannelFromSocketMessage(socket, command) {
    const resolved =
      command.commandType === AGENT_COMMAND.INTERACTION_RESPONSE
        ? this.resolveInteractionChannel(command)
        : this.resolveIdentityChannel(socket, command);
    void writeAgentProxyRouteDebugEvent({
      event: resolved.channel
        ? "agentProxy.route.resolve.matched"
        : "agentProxy.route.resolve.notFound",
      payload: command,
      socket,
      channel: resolved.channel,
      data: { routeSource: resolved.routeSource },
    });
    return resolved.channel;
  }

  resolveInteractionChannel(command) {
    const channel = this.getChannelByRequestId(command.interaction.requestId);
    return { routeSource: "pending_interaction", channel };
  }

  resolveIdentityChannel(socket, command) {
    const { identity } = command;
    const channelKey = createChannelKey({
      userId: socket.__agentProxyUserId,
      sessionId: identity.sessionId,
      parentSessionId: identity.parentSessionId,
      parentDialogProcessId: identity.parentDialogProcessId,
    });
    return { routeSource: "channel_key", channel: this.channelStore.get(channelKey) ?? null };
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
    this.logChannelEvent(channel, {
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
    this.logChannelEvent(channel, {
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
    this.logChannelEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.upstream.forward.error",
      data: {
        channelKey: channel.key,
        commandType: payload.commandType,
        error: describeForwardError(error),
      },
    });
  }

  settleForwardedInteractionResponse(channel, payload = {}) {
    const requestId = text((payload?.interaction ?? {}).requestId);
    if (!requestId) return;
    const resolvedEnvelope = channel.pendingInteractionRequests.get(requestId) || null;
    channel.pendingInteractionRequests.delete(requestId);
    if (!resolvedEnvelope) return;
    const resolved = projectResolvedInteractionIdentity(resolvedEnvelope);
    const hasRemainingInteraction = Array.from(channel.pendingInteractionRequests.values()).some(
      (envelope) => text(envelope.identity.turnScopeId) === resolved.turnScopeId,
    );
    this.updateConversationState(
      channel,
      buildInteractionConversationPatch({ resolved, hasRemainingInteraction, requestId }),
    );
  }

  forwardToUpstream(channel, payload) {
    if (channel.transport.socket?.readyState !== this.WebSocket.OPEN) {
      this.logForwardSkipped(channel, payload);
      return false;
    }
    const { commandType } = payload;
    try {
      channel.transport.socket.send(JSON.stringify(payload));
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

  startOrJoinChannel({ socket, payload }) {
    const { identity } = payload;
    const userId = socket.__agentProxyUserId;
    const { sessionId } = identity;
    const channelKey = createChannelKey({
      userId,
      sessionId,
      parentSessionId: identity.parentSessionId,
      parentDialogProcessId: identity.parentDialogProcessId,
    });
    const channel = this.ensureChannel(channelKey, payload);

    const nextPayloadFingerprint = buildFingerprint(payload);
    const hasReusableUpstream = channel.transport.socket?.readyState === this.WebSocket.OPEN;
    const isActiveChannelStatus =
      channel.activity.phase === CHANNEL_ACTIVITY_PHASE.RUNNING ||
      channel.transport.phase === UPSTREAM_TRANSPORT_PHASE.CONNECTING ||
      channel.pendingInteractionRequests.size > 0;
    const keepExistingRun = isActiveChannelStatus && hasReusableUpstream;

    this.attachSubscriber(channel, socket);
    if (keepExistingRun) {
      this.replayChannelEvents(
        channel,
        socket,
        socket.__agentProxyLastSequenceByChannel[channel.key],
      );
    } else {
      this.syncSocketToChannelTail(channel, socket);
    }
    this.logSessionEvent(channel, {
      category: "interaction",
      event: keepExistingRun ? "agentProxy.channel.join" : "agentProxy.channel.start",
      sessionId,
      data: {
        channelKey: channel.key,
        socketId: socket.__agentProxySocketId,
        keepExistingRun,
        sessionId,
        userId,
        channelActivityPhase: channel.activity.phase,
        channelTransportPhase: channel.transport.phase,
        hasReusableUpstream,
      },
    });

    if (keepExistingRun) return;

    channel.startPayload = { ...payload };
    channel.startFingerprint = nextPayloadFingerprint;
    const previousActivityPhase = channel.activity.phase;
    const previousTransportPhase = channel.transport.phase;
    channel.eventJournal.reset();
    channel.conversationStateByScope = new Map();
    this.updateConversationState(channel, {
      scope: AGENT_CHANNEL_STATE_SCOPE.SESSION,
      sessionId: channel.identity.sessionId,
      state: AGENT_CHANNEL_STATE.NO_CONVERSATION,
      sourceEvent: CONVERSATION_SOURCE_EVENT.RESTART,
      seq: 0,
    });
    this.resetChannelRun(channel);
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
        },
      });
    }
    this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.RESTART);
    this.connectUpstreamChannel(channel, socket.__agentProxyApiKey, socket.__agentProxyLocale, {
      initialCommands: [channel.startPayload],
      purpose: "run",
    });
  }
}

export const channelflowMethods = Object.getOwnPropertyDescriptors(ChannelFlowMethods.prototype);
delete channelflowMethods.constructor;
