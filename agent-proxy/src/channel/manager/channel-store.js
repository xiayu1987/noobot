/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  CHANNEL_ACTIVITY_PHASE,
  CHANNEL_RETENTION_PHASE,
  CONVERSATION_SOURCE_EVENT,
  SESSION_CHANNEL_STATE_KEY,
} from "../../shared/constants.js";
import {
  AGENT_CHANNEL_STATE,
  AGENT_CHANNEL_STATE_SCOPE,
  createAgentChannelState,
} from "@noobot/agent-transport-protocol";
import { nowMs, parseChannelKey } from "../../shared/utils.js";
import {
  isFailedTurnState,
  isTerminalTurnEvent,
  isTerminalTurnState,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_STATE,
} from "@noobot/session-protocol";
import {
  INTERACTION_EVENT_TYPE,
  isTerminalInteractionLifecycle,
  mergeTurnLifecycleEvents,
} from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";
import { text, isCanonicalText } from "@noobot/shared/value";

const RUNNING_CONVERSATION_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.SENDING,
  AGENT_CHANNEL_STATE.INTERACTION_PENDING,
]);
const TERMINAL_CONVERSATION_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.COMPLETED,
  AGENT_CHANNEL_STATE.USER_STOPPED,
  AGENT_CHANNEL_STATE.ERROR,
]);

function rejectedFrameIdentity(data) {
  return {
    sessionId: text(data?.identity?.sessionId),
    dialogProcessId: text(data?.payload?.dialogProcessId),
    turnScopeId: text(data?.identity?.turnScopeId),
  };
}

function readLifecycleScope(eventData) {
  const lifecycle = eventData.payload;
  return {
    eventName: lifecycle.eventType,
    dialogProcessId: lifecycle.dialogProcessId,
    turnScopeId: eventData.identity.turnScopeId,
    sessionId: eventData.identity.sessionId,
    seq: eventData.ordering.sequence,
  };
}

function resolveTerminalConversationState(eventName, lifecycleState) {
  if (isFailedTurnState(lifecycleState)) return AGENT_CHANNEL_STATE.ERROR;
  if (lifecycleState === TURN_STATE.STOP_COMPLETED || eventName === TURN_EVENT.STOP_COMPLETED) {
    return AGENT_CHANNEL_STATE.USER_STOPPED;
  }
  return AGENT_CHANNEL_STATE.COMPLETED;
}

function resolveLifecycleConversationState(eventName, lifecycle) {
  const lifecycleState = text(lifecycle.state);
  if ([TURN_STATE.PROCESSING, TURN_STATE.COMPLETION_REQUESTING].includes(lifecycleState)) {
    return AGENT_CHANNEL_STATE.SENDING;
  }
  if (lifecycleState === TURN_STATE.STOPPING) return AGENT_CHANNEL_STATE.STOPPING;
  if (isTerminalTurnEvent(eventName) || isTerminalTurnState(lifecycleState)) {
    return resolveTerminalConversationState(eventName, lifecycleState);
  }
  return "";
}

function activateChannelRetention(channel) {
  channel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
  channel.retention.terminalStatus = "";
  channel.retention.cleanupAfterMs = 0;
}

function matchesOptionalScope(expected, actual) {
  return !expected || text(actual) === expected;
}

function isPendingInteractionInScope(envelope, scope) {
  const identity = envelope?.identity || {};
  const interaction = envelope?.payload || {};
  return (
    matchesOptionalScope(scope.sessionId, identity.sessionId) &&
    matchesOptionalScope(scope.dialogProcessId, interaction.dialogProcessId) &&
    matchesOptionalScope(scope.turnScopeId, identity.turnScopeId)
  );
}

function clearScopedPendingInteractions(channel, scope) {
  let clearedCount = 0;
  for (const [requestId, envelope] of channel.pendingInteractionRequests.entries()) {
    if (!isPendingInteractionInScope(envelope, scope)) continue;
    channel.pendingInteractionRequests.delete(requestId);
    clearedCount += 1;
  }
  return clearedCount;
}

function cleanupTerminalChannel(store, channel, scope, nextState) {
  if (scope.sessionId && scope.sessionId !== channel.identity.sessionId) return;
  const clearedPendingInteractionCount = clearScopedPendingInteractions(channel, scope);
  store.logSessionEvent(channel, {
    category: "interaction",
    event: "agentProxy.interaction.terminalCleanup",
    sessionId: scope.sessionId,
    dialogProcessId: scope.dialogProcessId,
    turnScopeId: scope.turnScopeId,
    data: {
      lifecycleEventType: scope.eventName,
      terminalState: nextState,
      clearedPendingInteractionCount,
      remainingPendingInteractionCount: channel.pendingInteractionRequests.size,
    },
  });
  store.markChannelTerminal(channel, nextState);
}

function buildTurnLifecycleReplay(window, sequence) {
  if (!window.length) return { events: [], hasReplayGap: sequence > 0 };
  const first = window[0].ordering.sequence;
  let previous = first - 1;
  const hasGap = window.some((item) => {
    const current = item.ordering.sequence;
    const gap = current !== previous + 1;
    previous = current;
    return gap;
  });
  if (hasGap || sequence < first - 1) return { events: [], hasReplayGap: true };
  return {
    events: window.filter((item) => item.ordering.sequence > sequence),
    hasReplayGap: false,
  };
}

function latestLifecycleEntry(channels = [], sessionId = "") {
  return (
    mergeTurnLifecycleEvents(
      sessionId,
      channels.flatMap((channel) => channel.lifecycleWindowsBySessionId.get(sessionId) ?? []),
    ).at(-1) ?? null
  );
}

class ChannelStoreMethods {
  ensureChannel(channelKey, startPayload) {
    const existingChannel = this.channelStore.get(channelKey);
    if (existingChannel) return existingChannel;
    const identity = parseChannelKey(channelKey);
    const upstreamTransport = this.createUpstreamTransport();
    const nextChannel = {
      key: channelKey,
      identity,
      createdAtMs: nowMs(),
      updatedAtMs: nowMs(),
      subscribers: new Set(),
      transport: upstreamTransport,
      activity: { phase: CHANNEL_ACTIVITY_PHASE.IDLE },
      retention: {
        phase: CHANNEL_RETENTION_PHASE.ACTIVE,
        terminalStatus: "",
        cleanupAfterMs: 0,
      },
      apiKey: "",
      locale: "",
      startPayload: { ...startPayload },
      startFingerprint: "",
      eventJournal: this.createEventJournal(),
      lifecycleWindowsBySessionId: new Map(),
      pendingInteractionRequests: new Map(),
      upstreamClosed: false,
      _errorHandled: false,
      conversationStateByScope: new Map(),
    };
    this.channelStore.set(channelKey, nextChannel);
    this.updateConversationState(nextChannel, {
      scope: AGENT_CHANNEL_STATE_SCOPE.SESSION,
      sessionId: nextChannel.identity.sessionId,
      state: AGENT_CHANNEL_STATE.NO_CONVERSATION,
      sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
      seq: 0,
      broadcast: false,
    });
    return nextChannel;
  }

  deleteChannel(channelKey) {
    const channel = this.channelStore.get(channelKey);
    for (const subscriber of channel.subscribers) {
      this.clearChannelLifecycleDeliveries(subscriber, channelKey);
      subscriber.__agentProxyChannelKeys.delete(channelKey);
      delete subscriber.__agentProxyLastSequenceByChannel[channelKey];
    }
    channel.transport.dispose(1000, "channel_deleted");
    this.channelStore.delete(channelKey);
  }

  get channelCount() {
    return this.channelStore.size;
  }

  resetChannelRun(channel) {
    activateChannelRetention(channel);
    channel.activity.phase = CHANNEL_ACTIVITY_PHASE.IDLE;
    channel.upstreamClosed = false;
    channel._errorHandled = false;
  }

  admitInteractionRequest(channel, data) {
    const { requestId, lifecycle } = data.payload;
    if (isTerminalInteractionLifecycle(lifecycle) || !this.getChannelByRequestId(requestId)) {
      return true;
    }
    this.logChannelEvent(channel, {
      category: "interaction",
      level: "warn",
      event: "agentProxy.interaction.rejected",
      data: {
        requestId,
        reason: "duplicate_request_id",
        frameIdentity: rejectedFrameIdentity(data),
      },
    });
    return false;
  }

  pushChannelEvent(channel, eventName, data) {
    if (
      eventName === INTERACTION_EVENT_TYPE.REQUEST &&
      !this.admitInteractionRequest(channel, data)
    ) {
      return null;
    }
    channel.updatedAtMs = nowMs();
    if (isTransientMessageEvent(data)) {
      this.recordSuccessfulDataPlaneOperation("channelEvents");
      return channel.eventJournal.transient(eventName, data);
    }
    const envelope = channel.eventJournal.append(eventName, data);
    if (envelope.event === TURN_LIFECYCLE_WIRE_EVENT) {
      this.recordTurnLifecycleEnvelope(channel, envelope.data);
    }
    this.recordSuccessfulDataPlaneOperation("channelEvents");
    if (envelope.event === INTERACTION_EVENT_TYPE.REQUEST) {
      const protocolEnvelope = envelope.data;
      const interaction = protocolEnvelope.payload;
      const { requestId } = interaction;
      if (isTerminalInteractionLifecycle(interaction.lifecycle)) {
        channel.pendingInteractionRequests.delete(requestId);
        this.updateConversationState(channel, {
          scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
          dialogProcessId: interaction.dialogProcessId,
          turnScopeId: protocolEnvelope.identity.turnScopeId,
          state: AGENT_CHANNEL_STATE.SENDING,
          sourceEvent: INTERACTION_EVENT_TYPE.REQUEST,
          seq: protocolEnvelope.ordering.sequence,
          sessionId: protocolEnvelope.identity.sessionId,
          requestId,
        });
      } else {
        channel.pendingInteractionRequests.set(requestId, protocolEnvelope);
        this.updateConversationState(channel, {
          scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
          dialogProcessId: interaction.dialogProcessId,
          turnScopeId: protocolEnvelope.identity.turnScopeId,
          state: AGENT_CHANNEL_STATE.INTERACTION_PENDING,
          sourceEvent: INTERACTION_EVENT_TYPE.REQUEST,
          seq: protocolEnvelope.ordering.sequence,
          sessionId: protocolEnvelope.identity.sessionId,
          requestId,
        });
      }
    }
    if (envelope.event === TURN_LIFECYCLE_WIRE_EVENT) {
      this._applyAuthoritativeConversationState(channel, envelope.data);
    }
    return envelope;
  }

  recordTurnLifecycleEnvelope(channel, lifecycleEnvelope) {
    const { sessionId } = lifecycleEnvelope.identity;
    const current = channel.lifecycleWindowsBySessionId.get(sessionId) ?? [];
    const next = mergeTurnLifecycleEvents(sessionId, [...current, lifecycleEnvelope]).slice(
      -config.maxChannelEvents,
    );
    channel.lifecycleWindowsBySessionId.set(sessionId, next);
    return next;
  }

  getTurnLifecycleReplay(channel, sessionId, knownSequence) {
    const normalizedSessionId = text(sessionId);
    const window = channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || [];
    return buildTurnLifecycleReplay(window, knownSequence);
  }

  getTurnLifecycleReplayForChannels(channels, sessionId, knownSequence) {
    const window = mergeTurnLifecycleEvents(
      sessionId,
      channels.flatMap((channel) => channel.lifecycleWindowsBySessionId.get(sessionId) ?? []),
    );
    return buildTurnLifecycleReplay(window, knownSequence);
  }

  hasActiveTurnLifecycleForChannels(channels, sessionId) {
    const latest = latestLifecycleEntry(channels, sessionId);
    if (!latest) return false;
    const { eventType, state } = latest.payload;
    return !isTerminalTurnEvent(eventType) && !isTerminalTurnState(state);
  }

  updateConversationState(
    channel,
    {
      scope,
      sessionId,
      turnScopeId = "",
      dialogProcessId = "",
      state,
      sourceEvent,
      seq,
      requestId = "",
      broadcast = true,
    },
  ) {
    const stateKey =
      scope === AGENT_CHANNEL_STATE_SCOPE.SESSION ? SESSION_CHANNEL_STATE_KEY : text(turnScopeId);
    const previousStateItem = channel.conversationStateByScope.get(stateKey) || null;
    if (
      previousStateItem &&
      previousStateItem.state === state &&
      previousStateItem.seq === seq &&
      previousStateItem.sourceEvent === sourceEvent &&
      text(previousStateItem.requestId) === text(requestId)
    ) {
      return previousStateItem;
    }
    const updatedAtMs = nowMs();
    const stateItem = createAgentChannelState({
      scope,
      sessionId,
      turnScopeId,
      dialogProcessId,
      state,
      sourceEvent,
      seq,
      createdAtMs: previousStateItem?.createdAtMs ?? updatedAtMs,
      updatedAtMs,
      requestId,
    });
    channel.conversationStateByScope.set(stateKey, stateItem);
    this.logSessionEvent(channel, {
      category: "state",
      event: "agentProxy.conversation.state",
      sessionId: stateItem.sessionId,
      dialogProcessId: stateItem.dialogProcessId,
      turnScopeId: stateItem.turnScopeId,
      data: {
        channelKey: channel.key,
        scope: stateItem.scope,
        state: stateItem.state,
        sourceEvent: stateItem.sourceEvent,
        seq: stateItem.seq,
        requestId: stateItem.requestId,
      },
    });
    if (broadcast) {
      this.broadcastChannelState(channel, stateItem);
    }
    return stateItem;
  }

  _applyAuthoritativeConversationState(channel, eventData) {
    const lifecycle = eventData.payload;
    const scope = readLifecycleScope(eventData);
    const nextState = resolveLifecycleConversationState(scope.eventName, lifecycle);
    if (!nextState) return;
    if (RUNNING_CONVERSATION_STATES.includes(nextState)) {
      activateChannelRetention(channel);
      channel.activity.phase = CHANNEL_ACTIVITY_PHASE.RUNNING;
    } else if (TERMINAL_CONVERSATION_STATES.includes(nextState)) {
      cleanupTerminalChannel(this, channel, scope, nextState);
    }
    this.updateConversationState(channel, {
      scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
      dialogProcessId: scope.dialogProcessId,
      turnScopeId: scope.turnScopeId,
      state: nextState,
      sourceEvent: scope.eventName,
      seq: scope.seq,
      sessionId: scope.sessionId,
      requestId: text(lifecycle.requestId),
      broadcast: false,
    });
  }

  getChannelByRequestId(requestId) {
    for (const channel of this.channelStore.values()) {
      if (channel.pendingInteractionRequests.has(requestId)) return channel;
    }
    return null;
  }

  saveApiKeyIdentity({ apiKey, userId }) {
    if (!isCanonicalText(apiKey) || !isCanonicalText(userId)) {
      throw new TypeError("api key identity requires canonical apiKey and userId");
    }
    this.apiKeyIdentityStore.set(apiKey, { userId, updatedAtMs: nowMs() });
  }

  resolveApiKeyIdentity(apiKey) {
    return this.apiKeyIdentityStore.get(apiKey);
  }

  hasChannelPermission(channel, socket) {
    return channel.identity.userId === socket.__agentProxyUserId;
  }
}

export const channelstoreMethods = Object.getOwnPropertyDescriptors(ChannelStoreMethods.prototype);
delete channelstoreMethods.constructor;
