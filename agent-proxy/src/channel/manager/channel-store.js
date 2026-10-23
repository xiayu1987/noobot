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
  isAuthoritativeTurnLifecycleEnvelope,
} from "@noobot/session-protocol";
import {
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  isTerminalInteractionLifecycle,
  validateProtocolEvent,
} from "@noobot/event-protocol";
import { isTransientMessageEvent } from "@noobot/event-protocol/message-event";
import { validateDataPlaneEvent } from "./data-plane-event-validator.js";
import { text, isObjectLike, isCanonicalText } from "@noobot/shared/value";

const RUNNING_CONVERSATION_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.SENDING,
  AGENT_CHANNEL_STATE.INTERACTION_PENDING,
]);
const TERMINAL_CONVERSATION_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.COMPLETED,
  AGENT_CHANNEL_STATE.USER_STOPPED,
  AGENT_CHANNEL_STATE.ERROR,
]);

function readAuthoritativeLifecycle(channel, eventData) {
  const validation = validateProtocolEvent(eventData);
  if (!channel || !validation.valid) return null;
  if (validation.descriptor?.family !== EVENT_FAMILY.TURN_LIFECYCLE) return null;
  const lifecycle = eventData.payload;
  return isAuthoritativeTurnLifecycleEnvelope(lifecycle) ? lifecycle : null;
}

function rejectedFrameIdentity(data) {
  return {
    sessionId: text(data?.identity?.sessionId),
    dialogProcessId: text(data?.payload?.dialogProcessId),
    turnScopeId: text(data?.identity?.turnScopeId),
  };
}

function readLifecycleScope(eventData, lifecycle) {
  const identity = eventData.identity || {};
  return {
    eventName: text(lifecycle.eventType),
    dialogProcessId: text(lifecycle.dialogProcessId),
    turnScopeId: text(identity.turnScopeId),
    sessionId: text(identity.sessionId),
    seq: Number(eventData.ordering?.sequence || 0),
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
  const first = Number(window[0]?.ordering?.sequence || 0);
  let previous = first - 1;
  const hasGap = window.some((item) => {
    const current = Number(item?.ordering?.sequence || 0);
    const gap = current !== previous + 1;
    previous = current;
    return gap;
  });
  if (hasGap || sequence < first - 1) return { events: [], hasReplayGap: true };
  return {
    events: window.filter((item) => Number(item?.ordering?.sequence) > sequence),
    hasReplayGap: false,
  };
}

function latestLifecycleEntry(channels = [], sessionId = "") {
  const normalizedSessionId = text(sessionId);
  return (
    channels
      .flatMap((channel) =>
        (channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || []).map((envelope) => ({
          channel,
          envelope,
        })),
      )
      .sort(
        (left, right) =>
          Number(left.envelope?.ordering?.sequence || 0) -
            Number(right.envelope?.ordering?.sequence || 0) ||
          Number(left.envelope?.ordering?.revision || 0) -
            Number(right.envelope?.ordering?.revision || 0),
      )
      .at(-1) || null
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

  pushChannelEvent(channel, eventName = "", data = {}) {
    if (!channel) return null;
    const normalizedEventName = text(eventName);
    if (!normalizedEventName) return null;
    const dataPlaneValidation = validateDataPlaneEvent(normalizedEventName, data);
    if (!dataPlaneValidation.valid) {
      this.logChannelEvent(channel, {
        category: "protocol",
        level: "warn",
        event: "agentProxy.channelEvent.rejected",
        data: {
          wireEvent: normalizedEventName,
          errors: dataPlaneValidation.errors,
          frameIdentity: rejectedFrameIdentity(data),
        },
      });
      return null;
    }
    if (normalizedEventName === INTERACTION_EVENT_TYPE.REQUEST) {
      const validation = validateProtocolEvent(data);
      const requestId = text(data?.payload?.requestId);
      const lifecycle = (text(data?.payload?.lifecycle) || "pending").toLowerCase();
      const isTerminal = validation.valid && isTerminalInteractionLifecycle(lifecycle);
      if (
        !validation.valid ||
        validation.descriptor?.family !== EVENT_FAMILY.INTERACTION_REQUEST ||
        (!isTerminal && this.getChannelByRequestId(requestId))
      ) {
        this.logChannelEvent(channel, {
          category: "interaction",
          level: "warn",
          event: "agentProxy.interaction.rejected",
          data: {
            requestId,
            reason: validation.valid
              ? isTerminal
                ? "terminal_without_pending_request"
                : "duplicate_request_id"
              : "invalid_protocol_event",
            errors: validation.errors,
            frameIdentity: rejectedFrameIdentity(data),
          },
        });
        return null;
      }
    }
    if (normalizedEventName === TURN_LIFECYCLE_WIRE_EVENT) {
      const validation = validateProtocolEvent(data);
      if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.TURN_LIFECYCLE) {
        this.logChannelEvent(channel, {
          category: "protocol",
          level: "warn",
          event: "agentProxy.turnLifecycle.rejected",
          data: {
            eventId: text(data?.identity?.eventId),
            errors: validation.errors,
            frameIdentity: rejectedFrameIdentity(data),
          },
        });
        return null;
      }
    }
    channel.updatedAtMs = nowMs();
    if (isTransientMessageEvent(data)) {
      this.recordSuccessfulDataPlaneOperation("channelEvents");
      return channel.eventJournal.transient(normalizedEventName, data);
    }
    const envelope = channel.eventJournal.append(normalizedEventName, data);
    if (envelope.event === TURN_LIFECYCLE_WIRE_EVENT) {
      this.recordTurnLifecycleEnvelope(channel, envelope.data);
    }
    this.recordSuccessfulDataPlaneOperation("channelEvents");
    if (String(envelope.event || "") === INTERACTION_EVENT_TYPE.REQUEST) {
      const protocolEnvelope = envelope.data;
      const interaction = protocolEnvelope.payload;
      const requestId = text(interaction.requestId);
      if (isTerminalInteractionLifecycle(interaction.lifecycle)) {
        channel.pendingInteractionRequests.delete(requestId);
        this.updateConversationState(channel, {
          scope: AGENT_CHANNEL_STATE_SCOPE.TURN,
          dialogProcessId: interaction.dialogProcessId,
          turnScopeId: protocolEnvelope.identity.turnScopeId,
          state: AGENT_CHANNEL_STATE.SENDING,
          sourceEvent: INTERACTION_EVENT_TYPE.REQUEST,
          seq: Number(protocolEnvelope.ordering.sequence),
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
          seq: Number(protocolEnvelope.ordering.sequence),
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

  recordTurnLifecycleEnvelope(channel, lifecycleEnvelope = {}) {
    if (!channel || !isObjectLike(lifecycleEnvelope)) return null;
    const sessionId = text(lifecycleEnvelope?.identity?.sessionId);
    const sequence = Number(lifecycleEnvelope?.ordering?.sequence || 0);
    const eventId = text(lifecycleEnvelope?.identity?.eventId);
    if (!sessionId || !Number.isInteger(sequence) || sequence < 1 || !eventId) return null;
    channel.lifecycleWindowsBySessionId ||= new Map();
    const current = channel.lifecycleWindowsBySessionId.get(sessionId) || [];
    if (
      current.some(
        (item) =>
          item?.identity?.eventId === eventId || Number(item?.ordering?.sequence) === sequence,
      )
    )
      return null;
    const next = [...current, lifecycleEnvelope]
      .sort(
        (left, right) =>
          Number(left?.ordering?.sequence || 0) - Number(right?.ordering?.sequence || 0),
      )
      .slice(-config.maxChannelEvents);
    channel.lifecycleWindowsBySessionId.set(sessionId, next);
    return next;
  }

  getTurnLifecycleReplay(channel, sessionId, knownSequence) {
    const normalizedSessionId = text(sessionId);
    const window = channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || [];
    return buildTurnLifecycleReplay(window, knownSequence);
  }

  getTurnLifecycleReplayForChannels(channels, sessionId, knownSequence) {
    const normalizedSessionId = text(sessionId);
    const mergedBySequence = new Map();
    for (const channel of channels) {
      for (const envelope of channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || []) {
        const sequence = Number(envelope?.ordering?.sequence || 0);
        if (sequence < 1) continue;
        const existing = mergedBySequence.get(sequence);
        if (
          !existing ||
          Number(envelope?.ordering?.revision || 0) >= Number(existing?.ordering?.revision || 0)
        ) {
          mergedBySequence.set(sequence, envelope);
        }
      }
    }
    const window = Array.from(mergedBySequence.values()).sort(
      (left, right) =>
        Number(left?.ordering?.sequence || 0) - Number(right?.ordering?.sequence || 0),
    );
    return buildTurnLifecycleReplay(window, knownSequence);
  }

  getActiveTurnLifecycleProjection(channel, sessionId = "") {
    return this.getActiveTurnLifecycleProjectionForChannels([channel], sessionId);
  }

  getActiveTurnLifecycleProjectionForChannels(channels = [], sessionId = "") {
    const normalizedSessionId = text(sessionId);
    const latestEntry = latestLifecycleEntry(channels, normalizedSessionId);
    const latest = latestEntry?.envelope || null;
    const validation = validateProtocolEvent(latest);
    if (
      !latest ||
      !validation.valid ||
      validation.descriptor?.family !== EVENT_FAMILY.TURN_LIFECYCLE
    )
      return null;
    const lifecycle = latest.payload;
    const eventType = text(lifecycle?.eventType);
    const lifecycleState = text(lifecycle?.state);
    if (isTerminalTurnEvent(eventType) || isTerminalTurnState(lifecycleState)) {
      return null;
    }
    const turnScopeId = text(latest?.identity?.turnScopeId);
    if (!turnScopeId) return null;
    const dialogProcessId = text(lifecycle?.dialogProcessId);
    const conversationState = channels
      .map((channel) => channel.conversationStateByScope.get(turnScopeId))
      .filter(Boolean)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .at(0);
    const projectedState =
      text(conversationState?.state) ||
      (eventType === TURN_EVENT.STOP_ACCEPTED
        ? AGENT_CHANNEL_STATE.STOPPING
        : AGENT_CHANNEL_STATE.SENDING);
    return {
      ...lifecycle,
      sessionId: normalizedSessionId,
      dialogProcessId,
      turnScopeId,
      state: projectedState,
      lifecycleState,
      authoritativeLifecycle: true,
    };
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

  _applyAuthoritativeConversationState(channel, eventData = {}) {
    const lifecycle = readAuthoritativeLifecycle(channel, eventData);
    if (!lifecycle) return;
    const scope = readLifecycleScope(eventData, lifecycle);
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
