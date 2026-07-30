/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  CHANNEL_EVENT,
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  CLIENT_ROLE,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
} from "../../shared/constants.js";
import {
  normalizeApiKey,
  nowMs,
} from "../../shared/utils.js";
import {
  TURN_EVENT,
  TURN_STATE,
  isAuthoritativeTurnLifecycleEnvelope,
} from "@noobot/authoritative-state/contracts";

const TERMINAL_TURN_EVENTS = new Set([
  TURN_EVENT.COMPLETED,
  TURN_EVENT.STOP_COMPLETED,
  TURN_EVENT.FAILED,
]);
const TERMINAL_TURN_STATES = new Set([
  TURN_STATE.COMPLETED,
  TURN_STATE.STOP_COMPLETED,
  TURN_STATE.ACTION_FAILED,
  TURN_STATE.PROCESSING_FAILED,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

function buildTurnLifecycleReplay(window = [], knownSequence = 0) {
  const sequence = Number(knownSequence || 0);
  if (!window.length) return { events: [], requiresSnapshot: sequence > 0 };
  const first = Number(window[0]?.sequence || 0);
  let previous = first - 1;
  const hasGap = window.some((item) => {
    const current = Number(item?.sequence || 0);
    const gap = current !== previous + 1;
    previous = current;
    return gap;
  });
  if (hasGap || sequence < first - 1) return { events: [], requiresSnapshot: true };
  return {
    events: window.filter((item) => Number(item.sequence) > sequence),
    requiresSnapshot: false,
  };
}

function latestLifecycleEntry(channels = [], sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return channels
    .flatMap((channel) =>
      (channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || []).map((envelope) => ({
        channel,
        envelope,
      })),
    )
    .sort((left, right) =>
      Number(left.envelope?.sequence || 0) - Number(right.envelope?.sequence || 0) ||
      Number(left.envelope?.revision || 0) - Number(right.envelope?.revision || 0),
    )
    .at(-1) || null;
}

class ChannelStoreMethods {

ensureChannel(channelKey = "", startPayload = {}) {
  const normalizedChannelKey = String(channelKey || "").trim();
  if (!normalizedChannelKey) return null;
  const existingChannel = this.channelStore.get(normalizedChannelKey);
  if (existingChannel) return existingChannel;
  const upstreamTransport = this.createUpstreamTransport();
  const eventJournal = this.createEventJournal();
  const nextChannel = {
    key: normalizedChannelKey,
    createdAtMs: nowMs(),
    updatedAtMs: nowMs(),
    subscribers: new Set(),
    transport: upstreamTransport,
    activity: { phase: CHANNEL_STATUS.IDLE },
    retention: {
      phase: CHANNEL_RETENTION_PHASE.ACTIVE,
      terminalStatus: "",
      cleanupAfterMs: 0,
    },
    apiKey: "",
    locale: "",
    startPayload: null,
    startFingerprint: "",
    eventJournal,
    lifecycleWindowsBySessionId: new Map(),
    pendingSnapshotRequests: this.commandRegistry.createMapFacade(normalizedChannelKey, "turn_snapshot"),
    pendingInteractionRequests: new Map(),
    upstreamClosed: false,
    ownerApiKey: "",
    ownerUserId: "",
    _errorHandled: false,
    conversationStateByDialogProcessId: new Map(),
  };
  Object.defineProperties(nextChannel, {
    upstreamSocket: {
      enumerable: false,
      get: () => upstreamTransport.socket,
      set: (socket) => upstreamTransport.adopt(socket),
    },
    upstreamEverConnected: {
      enumerable: false,
      get: () => upstreamTransport.everConnected,
      set: (value) => { if (value) upstreamTransport.everConnected = true; },
    },
    cleanupAfterMs: {
      enumerable: false,
      get: () => nextChannel.retention.cleanupAfterMs,
      set: (value) => { nextChannel.retention.cleanupAfterMs = Number(value || 0); },
    },
    status: {
      enumerable: false,
      get: () => nextChannel.retention.terminalStatus ||
        (nextChannel.activity.phase === CHANNEL_STATUS.RUNNING ? CHANNEL_STATUS.RUNNING : upstreamTransport.phase),
      set: (value) => {
        const normalized = String(value || "").trim();
        if ([CHANNEL_STATUS.DONE, CHANNEL_STATUS.USER_STOPPED, CHANNEL_STATUS.ERROR].includes(normalized)) {
          nextChannel.retention.phase = CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED;
          nextChannel.retention.terminalStatus = normalized;
          return;
        }
        nextChannel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
        nextChannel.retention.terminalStatus = "";
        if (normalized === CHANNEL_STATUS.RUNNING) {
          nextChannel.activity.phase = CHANNEL_STATUS.RUNNING;
          return;
        }
        nextChannel.activity.phase = CHANNEL_STATUS.IDLE;
        upstreamTransport.phase = normalized || CHANNEL_STATUS.IDLE;
      },
    },
    eventLog: {
      enumerable: false,
      get: () => eventJournal.events,
      set: (events) => { eventJournal.events = Array.isArray(events) ? events : []; },
    },
    eventSequence: {
      enumerable: false,
      get: () => eventJournal.sequence,
      set: (value) => { eventJournal.sequence = Math.max(0, Number(value || 0)); },
    },
  });
  if (startPayload && typeof startPayload === "object") {
    nextChannel.startPayload = { ...startPayload };
  }
  this.channelStore.set(normalizedChannelKey, nextChannel);
  this.updateConversationState(nextChannel, {
    dialogProcessId: "",
    state: CONVERSATION_STATE.NO_CONVERSATION,
    sourceEvent: CONVERSATION_SOURCE_EVENT.INIT,
    seq: 0,
    broadcast: false,
  });
  return nextChannel;
}

getChannel(channelKey) {
  return this.channelStore.get(String(channelKey || "").trim()) || null;
}

hasChannel(channelKey) {
  return this.channelStore.has(String(channelKey || "").trim());
}

deleteChannel(channelKey) {
  const normalizedChannelKey = String(channelKey || "").trim();
  const channel = this.channelStore.get(normalizedChannelKey);
  channel?.transport?.dispose?.(1000, "channel_deleted");
  this.channelStore.delete(normalizedChannelKey);
}

get channelCount() {
  return this.channelStore.size;
}


pushChannelEvent(channel, eventName = "", data = {}) {
  if (!channel) return null;
  channel.updatedAtMs = nowMs();
  const envelope = channel.eventJournal.append(
    String(eventName || CHANNEL_EVENT.MESSAGE).trim() || CHANNEL_EVENT.MESSAGE,
    data,
  );
  if (envelope.event === CHANNEL_EVENT.TURN_LIFECYCLE) {
    this.recordTurnLifecycleEnvelope(channel, envelope.data);
  }
  this.recordSuccessfulDataPlaneOperation("channelEvents");
  if (String(envelope.event || "") === CHANNEL_EVENT.INTERACTION_REQUEST) {
    const requestId = String(envelope?.data?.requestId || "").trim();
    if (requestId) {
      this.commandRegistry.registerRoute(requestId, { channelKey: channel.key, createdAtMs: nowMs() });
      channel.pendingInteractionRequests.set(requestId, envelope);
    }
  }
  this._applyConversationStateFromEnvelope(channel, envelope);
  return envelope;
}

recordTurnLifecycleEnvelope(channel, lifecycleEnvelope = {}) {
  if (!channel || !lifecycleEnvelope || typeof lifecycleEnvelope !== "object") return null;
  const sessionId = String(lifecycleEnvelope.sessionId || "").trim();
  const sequence = Number(lifecycleEnvelope.sequence || 0);
  const revision = Number(lifecycleEnvelope.revision || 0);
  const eventId = String(lifecycleEnvelope.eventId || "").trim();
  if (!sessionId || !Number.isInteger(sequence) || sequence < 1 || !eventId) return null;
  channel.lifecycleWindowsBySessionId ||= new Map();
  const current = channel.lifecycleWindowsBySessionId.get(sessionId) || [];
  if (current.some((item) => item.eventId === eventId || item.sequence === sequence)) return null;
  const next = [...current, { ...lifecycleEnvelope, sequence, revision, eventId }]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-config.maxChannelEvents);
  channel.lifecycleWindowsBySessionId.set(sessionId, next);
  return next;
}

getTurnLifecycleReplay(channel, sessionId = "", knownSequence = 0) {
  const normalizedSessionId = String(sessionId || "").trim();
  const window = channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || [];
  return buildTurnLifecycleReplay(window, knownSequence);
}

getTurnLifecycleReplayForChannels(channels = [], sessionId = "", knownSequence = 0) {
  const normalizedSessionId = String(sessionId || "").trim();
  const mergedBySequence = new Map();
  for (const channel of channels) {
    for (const envelope of channel?.lifecycleWindowsBySessionId?.get(normalizedSessionId) || []) {
      const sequence = Number(envelope?.sequence || 0);
      if (sequence < 1) continue;
      const existing = mergedBySequence.get(sequence);
      if (!existing || Number(envelope?.revision || 0) >= Number(existing?.revision || 0)) {
        mergedBySequence.set(sequence, envelope);
      }
    }
  }
  const window = Array.from(mergedBySequence.values()).sort(
    (left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0),
  );
  return buildTurnLifecycleReplay(window, knownSequence);
}

getActiveTurnLifecycleProjection(channel, sessionId = "") {
  return this.getActiveTurnLifecycleProjectionForChannels([channel], sessionId);
}

getActiveTurnLifecycleProjectionForChannels(channels = [], sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const latestEntry = latestLifecycleEntry(channels, normalizedSessionId);
  const latest = latestEntry?.envelope || null;
  if (!latest || !isAuthoritativeTurnLifecycleEnvelope(latest)) return null;
  const eventType = String(latest?.eventType || "").trim();
  const lifecycleState = String(latest?.state || "").trim();
  if (TERMINAL_TURN_EVENTS.has(eventType) || TERMINAL_TURN_STATES.has(lifecycleState)) {
    return null;
  }
  const turnScopeId = String(latest?.turnScopeId || "").trim();
  if (!turnScopeId) return null;
  const dialogProcessId = String(latest?.dialogProcessId || "").trim();
  const conversationState = channels
    .flatMap((channel) => [...(channel?.conversationStateByDialogProcessId?.values?.() || [])])
    .filter((item) => String(item?.turnScopeId || "").trim() === turnScopeId)
    .sort((left, right) => Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0))
    .at(0);
  const projectedState = String(conversationState?.state || "").trim() ||
    (eventType === TURN_EVENT.STOP_ACCEPTED ? CONVERSATION_STATE.STOPPING : CONVERSATION_STATE.SENDING);
  return {
    ...latest,
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
    dialogProcessId = "",
    state = "",
    sourceEvent = "",
    seq = 0,
    broadcast = true,
    sessionId = "",
    turnScopeId = "",
    createdAtMs = 0,
    requestId = "",
  } = {},
) {
  if (!channel) return null;
  const normalizedState = String(state || "").trim();
  if (!normalizedState) return null;
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const stateKey = normalizedDialogProcessId || CONVERSATION_SCOPE_KEY;
  const normalizedSessionId =
    String(sessionId || "").trim() || this._extractSessionIdFromChannelKey(channel.key);
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const previousStateItem = channel.conversationStateByDialogProcessId.get(stateKey) || null;
  if (
    previousStateItem &&
    previousStateItem.state === normalizedState &&
    Number(previousStateItem.seq || 0) === Number(seq || 0) &&
    (!normalizedTurnScopeId || String(previousStateItem?.turnScopeId || "").trim() === normalizedTurnScopeId) &&
    String(previousStateItem?.sourceEvent || "").trim() === String(sourceEvent || "").trim() &&
    String(previousStateItem?.requestId || "").trim() === String(requestId || "").trim()
  ) {
    return previousStateItem;
  }
  const nextCreatedAtMs = Number(
    createdAtMs || previousStateItem?.createdAtMs || previousStateItem?.updatedAtMs || nowMs(),
  );
  const stateItem = {
    sessionId: normalizedSessionId,
    dialogProcessId: normalizedDialogProcessId,
    turnScopeId: normalizedTurnScopeId || String(previousStateItem?.turnScopeId || "").trim(),
    state: normalizedState,
    sourceEvent: String(sourceEvent || "").trim(),
    seq: Number(seq || 0),
    createdAtMs: Number.isFinite(nextCreatedAtMs) ? nextCreatedAtMs : nowMs(),
    updatedAtMs: nowMs(),
    requestId: String(requestId || "").trim(),
  };
  channel.conversationStateByDialogProcessId.set(stateKey, stateItem);
  this.logSessionEvent(channel, {
    category: "state",
    event: "agentProxy.conversation.state",
    sessionId: stateItem.sessionId,
    dialogProcessId: stateItem.dialogProcessId,
    turnScopeId: stateItem.turnScopeId,
    data: {
      channelKey: channel.key,
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

_applyConversationStateFromEnvelope(channel, envelope = {}) {
  if (!channel || !envelope) return;
  const eventName = String(envelope?.event || "").trim();
  const eventData = envelope?.data || {};
  const dialogProcessId = String(eventData?.dialogProcessId || "").trim();
  const turnScopeId = String(
    eventData?.turnScopeId || channel?.startPayload?.turnScopeId || "",
  ).trim();
  const sessionId = String(eventData?.sessionId || "").trim();
  const seq = Number(eventData?.seq || envelope?.sequence || 0);
  const createdAtMs = Number(
    eventData?.createdAtMs ||
      eventData?.timestamp ||
      (eventData?.createdAt ? Date.parse(eventData.createdAt) : 0) ||
      0,
  );
  let nextState = "";
  if (eventName === CHANNEL_EVENT.THINKING || eventName === CHANNEL_EVENT.DELTA) {
    nextState = CONVERSATION_STATE.SENDING;
  } else if (eventName === CHANNEL_EVENT.INTERACTION_REQUEST) {
    nextState = CONVERSATION_STATE.INTERACTION_PENDING;
  } else if (eventName === CHANNEL_EVENT.DONE) {
    nextState = CONVERSATION_STATE.COMPLETED;
  } else if (eventName === CHANNEL_EVENT.USER_STOPPED) {
    nextState = CONVERSATION_STATE.USER_STOPPED;
  } else if (eventName === CHANNEL_EVENT.ERROR) {
    if (!String(eventData?.turnScopeId || "").trim() && !String(eventData?.dialogProcessId || "").trim()) {
      return;
    }
    nextState = CONVERSATION_STATE.ERROR;
  }
  if (!nextState) return;
  if ([CONVERSATION_STATE.SENDING, CONVERSATION_STATE.INTERACTION_PENDING].includes(nextState)) {
    channel.activity.phase = CHANNEL_STATUS.RUNNING;
    channel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
    channel.retention.terminalStatus = "";
    channel.retention.cleanupAfterMs = 0;
  } else if ([CONVERSATION_STATE.COMPLETED, CONVERSATION_STATE.USER_STOPPED, CONVERSATION_STATE.ERROR].includes(nextState)) {
    channel.activity.phase = CHANNEL_STATUS.IDLE;
    channel.retention.phase = CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED;
    channel.retention.terminalStatus = nextState === CONVERSATION_STATE.COMPLETED
      ? CHANNEL_STATUS.DONE
      : nextState;
    channel.retention.cleanupAfterMs = nowMs() + config.channelRetentionMs;
  }
  this.updateConversationState(channel, {
    dialogProcessId,
    turnScopeId,
    state: nextState,
    sourceEvent: eventName,
    seq,
    createdAtMs,
    sessionId,
  });
}


getChannelByRequestId(requestId) {
  const rid = String(requestId || "").trim();
  if (!rid || !this.requestChannelMap.has(rid)) return null;
  const mappedEntry = this.requestChannelMap.get(rid);
  const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
  return this.channelStore.get(mappedChannelKey) || null;
}


saveApiKeyIdentity({ apiKey = "", userId = "", role = "" } = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedApiKey || !normalizedUserId) return;
  this.apiKeyIdentityStore.set(normalizedApiKey, {
    apiKey: normalizedApiKey,
    userId: normalizedUserId,
    role: String(role || "").trim() || CLIENT_ROLE.USER,
    updatedAtMs: nowMs(),
  });
}

resolveApiKeyIdentity(apiKey = "") {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey || !this.apiKeyIdentityStore.has(normalizedApiKey)) return null;
  return this.apiKeyIdentityStore.get(normalizedApiKey) || null;
}


hasChannelPermission(channel, apiKey = "", requesterUserId = "") {
  if (!channel) return false;
  const normalizedApiKey = normalizeApiKey(apiKey);
  const ownerApiKey = normalizeApiKey(channel?.ownerApiKey || "");
  const normalizedRequesterUserId = String(requesterUserId || "").trim();
  const ownerUserId = String(channel?.ownerUserId || "").trim();
  if (ownerUserId && normalizedRequesterUserId && ownerUserId === normalizedRequesterUserId) {
    return true;
  }
  if (!ownerApiKey) return Boolean(normalizedApiKey);
  return Boolean(normalizedApiKey && normalizedApiKey === ownerApiKey);
}
}

export const channelstoreMethods = Object.getOwnPropertyDescriptors(ChannelStoreMethods.prototype);
delete channelstoreMethods.constructor;
