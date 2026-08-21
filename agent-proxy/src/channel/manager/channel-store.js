/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  CLIENT_ROLE,
  CONVERSATION_SCOPE_KEY,
  CONVERSATION_STATE,
  CONVERSATION_SOURCE_EVENT,
} from "../../shared/constants.js";
import { normalizeApiKey, nowMs } from "../../shared/utils.js";
import {
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
import { validateDataPlaneEvent } from "./data-plane-event-validator.js";

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
  const normalizedSessionId = String(sessionId || "").trim();
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
      pendingSnapshotRequests: this.commandRegistry.createMapFacade(
        normalizedChannelKey,
        "turn_snapshot",
      ),
      pendingExecutionRequests: this.commandRegistry.createMapFacade(
        normalizedChannelKey,
        "execution_query",
      ),
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
        set: (value) => {
          if (value) upstreamTransport.everConnected = true;
        },
      },
      cleanupAfterMs: {
        enumerable: false,
        get: () => nextChannel.retention.cleanupAfterMs,
        set: (value) => {
          nextChannel.retention.cleanupAfterMs = Number(value || 0);
        },
      },
      status: {
        enumerable: false,
        get: () =>
          nextChannel.retention.terminalStatus ||
          (nextChannel.activity.phase === CHANNEL_STATUS.RUNNING
            ? CHANNEL_STATUS.RUNNING
            : upstreamTransport.phase),
        set: (value) => {
          const normalized = String(value || "").trim();
          if (
            [CHANNEL_STATUS.DONE, CHANNEL_STATUS.USER_STOPPED, CHANNEL_STATUS.ERROR].includes(
              normalized,
            )
          ) {
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
        set: (events) => {
          eventJournal.events = Array.isArray(events) ? events : [];
        },
      },
      eventSequence: {
        enumerable: false,
        get: () => eventJournal.sequence,
        set: (value) => {
          eventJournal.sequence = Math.max(0, Number(value || 0));
        },
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
    for (const subscriber of channel?.subscribers || []) {
      subscriber?.__agentProxyChannelKeys?.delete?.(normalizedChannelKey);
      if (subscriber?.__agentProxyActiveChannelKey === normalizedChannelKey) {
        subscriber.__agentProxyActiveChannelKey = "";
      }
      if (subscriber?.__agentProxyLastSequenceByChannel) {
        delete subscriber.__agentProxyLastSequenceByChannel[normalizedChannelKey];
      }
    }
    channel?.transport?.dispose?.(1000, "channel_deleted");
    this.channelStore.delete(normalizedChannelKey);
  }

  get channelCount() {
    return this.channelStore.size;
  }

  pushChannelEvent(channel, eventName = "", data = {}) {
    if (!channel) return null;
    const normalizedEventName = String(eventName || "").trim();
    if (!normalizedEventName) return null;
    const dataPlaneValidation = validateDataPlaneEvent(normalizedEventName, data);
    if (!dataPlaneValidation.valid) {
      this.logSessionEvent(channel, {
        category: "protocol",
        level: "warn",
        event: "agentProxy.channelEvent.rejected",
        sessionId: data?.identity?.sessionId,
        turnScopeId: data?.identity?.turnScopeId,
        data: {
          wireEvent: normalizedEventName,
          errors: dataPlaneValidation.errors,
        },
      });
      return null;
    }
    if (normalizedEventName === INTERACTION_EVENT_TYPE.REQUEST) {
      const validation = validateProtocolEvent(data);
      const requestId = String(data?.payload?.requestId || "").trim();
      const lifecycle = String(data?.payload?.lifecycle || "pending")
        .trim()
        .toLowerCase();
      const isTerminal = validation.valid && isTerminalInteractionLifecycle(lifecycle);
      if (
        !validation.valid ||
        validation.descriptor?.family !== EVENT_FAMILY.INTERACTION_REQUEST ||
        (!isTerminal &&
          (channel.pendingInteractionRequests.has(requestId) ||
            this.requestChannelMap.has(requestId)))
      ) {
        this.logSessionEvent(channel, {
          category: "interaction",
          level: "warn",
          event: "agentProxy.interaction.rejected",
          sessionId: data?.identity?.sessionId,
          dialogProcessId: data?.payload?.dialogProcessId,
          turnScopeId: data?.identity?.turnScopeId,
          data: {
            requestId,
            reason: validation.valid
              ? isTerminal
                ? "terminal_without_pending_request"
                : "duplicate_request_id"
              : "invalid_protocol_event",
            errors: validation.errors,
          },
        });
        return null;
      }
    }
    if (normalizedEventName === TURN_LIFECYCLE_WIRE_EVENT) {
      const validation = validateProtocolEvent(data);
      if (!validation.valid || validation.descriptor?.family !== EVENT_FAMILY.TURN_LIFECYCLE) {
        this.logSessionEvent(channel, {
          category: "protocol",
          level: "warn",
          event: "agentProxy.turnLifecycle.rejected",
          sessionId: data?.identity?.sessionId,
          dialogProcessId: data?.payload?.dialogProcessId,
          turnScopeId: data?.identity?.turnScopeId,
          data: {
            eventId: String(data?.identity?.eventId || "").trim(),
            errors: validation.errors,
          },
        });
        return null;
      }
    }
    channel.updatedAtMs = nowMs();
    const envelope = channel.eventJournal.append(normalizedEventName, data);
    if (envelope.event === TURN_LIFECYCLE_WIRE_EVENT) {
      this.recordTurnLifecycleEnvelope(channel, envelope.data);
    }
    this.recordSuccessfulDataPlaneOperation("channelEvents");
    if (String(envelope.event || "") === INTERACTION_EVENT_TYPE.REQUEST) {
      const protocolEnvelope = envelope.data;
      const interaction = protocolEnvelope.payload;
      const requestId = String(interaction.requestId || "").trim();
      const lifecycle = String(interaction.lifecycle || "pending")
        .trim()
        .toLowerCase();
      if (isTerminalInteractionLifecycle(lifecycle)) {
        channel.pendingInteractionRequests.delete(requestId);
        this.requestChannelMap.delete(requestId);
        this.updateConversationState(channel, {
          dialogProcessId: interaction.dialogProcessId,
          turnScopeId: protocolEnvelope.identity.turnScopeId,
          state: CONVERSATION_STATE.SENDING,
          sourceEvent: INTERACTION_EVENT_TYPE.REQUEST,
          seq: Number(protocolEnvelope.ordering.sequence),
          sessionId: protocolEnvelope.identity.sessionId,
          requestId,
        });
      } else {
        this.commandRegistry.registerRoute(requestId, {
          channelKey: channel.key,
          createdAtMs: nowMs(),
        });
        channel.pendingInteractionRequests.set(requestId, protocolEnvelope);
        this.updateConversationState(channel, {
          dialogProcessId: interaction.dialogProcessId,
          turnScopeId: protocolEnvelope.identity.turnScopeId,
          state: CONVERSATION_STATE.INTERACTION_PENDING,
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
    if (!channel || !lifecycleEnvelope || typeof lifecycleEnvelope !== "object") return null;
    const sessionId = String(lifecycleEnvelope?.identity?.sessionId || "").trim();
    const sequence = Number(lifecycleEnvelope?.ordering?.sequence || 0);
    const eventId = String(lifecycleEnvelope?.identity?.eventId || "").trim();
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
    const normalizedSessionId = String(sessionId || "").trim();
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
    const eventType = String(lifecycle?.eventType || "").trim();
    const lifecycleState = String(lifecycle?.state || "").trim();
    if (TERMINAL_TURN_EVENTS.has(eventType) || TERMINAL_TURN_STATES.has(lifecycleState)) {
      return null;
    }
    const turnScopeId = String(latest?.identity?.turnScopeId || "").trim();
    if (!turnScopeId) return null;
    const dialogProcessId = String(lifecycle?.dialogProcessId || "").trim();
    const conversationState = channels
      .flatMap((channel) => [...(channel?.conversationStateByDialogProcessId?.values?.() || [])])
      .filter((item) => String(item?.turnScopeId || "").trim() === turnScopeId)
      .sort((left, right) => Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0))
      .at(0);
    const projectedState =
      String(conversationState?.state || "").trim() ||
      (eventType === TURN_EVENT.STOP_ACCEPTED
        ? CONVERSATION_STATE.STOPPING
        : CONVERSATION_STATE.SENDING);
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
      (!normalizedTurnScopeId ||
        String(previousStateItem?.turnScopeId || "").trim() === normalizedTurnScopeId) &&
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

  _applyAuthoritativeConversationState(channel, eventData = {}) {
    const validation = validateProtocolEvent(eventData);
    if (
      !channel ||
      !validation.valid ||
      validation.descriptor?.family !== EVENT_FAMILY.TURN_LIFECYCLE
    )
      return;
    const lifecycle = eventData.payload;
    if (!isAuthoritativeTurnLifecycleEnvelope(lifecycle)) return;
    const eventName = String(lifecycle?.eventType || "").trim();
    const dialogProcessId = String(lifecycle?.dialogProcessId || "").trim();
    const turnScopeId = String(eventData?.identity?.turnScopeId || "").trim();
    const sessionId = String(eventData?.identity?.sessionId || "").trim();
    const seq = Number(eventData?.ordering?.sequence || 0);
    const createdAtMs = Number((eventData?.occurredAt ? Date.parse(eventData.occurredAt) : 0) || 0);
    let nextState = "";
    const lifecycleState = String(lifecycle?.state || "").trim();
    if ([TURN_STATE.PROCESSING, TURN_STATE.COMPLETION_REQUESTING].includes(lifecycleState)) {
      nextState = CONVERSATION_STATE.SENDING;
    } else if (lifecycleState === TURN_STATE.STOPPING) {
      nextState = CONVERSATION_STATE.STOPPING;
    } else if (TERMINAL_TURN_EVENTS.has(eventName) || TERMINAL_TURN_STATES.has(lifecycleState)) {
      nextState = [
        TURN_STATE.ACTION_FAILED,
        TURN_STATE.PROCESSING_FAILED,
        TURN_STATE.COMPLETION_FAILED,
        TURN_STATE.STOP_FAILED,
      ].includes(lifecycleState)
        ? CONVERSATION_STATE.ERROR
        : lifecycleState === TURN_STATE.STOP_COMPLETED || eventName === TURN_EVENT.STOP_COMPLETED
          ? CONVERSATION_STATE.USER_STOPPED
          : CONVERSATION_STATE.COMPLETED;
    }
    if (!nextState) return;
    if ([CONVERSATION_STATE.SENDING, CONVERSATION_STATE.INTERACTION_PENDING].includes(nextState)) {
      channel.activity.phase = CHANNEL_STATUS.RUNNING;
      channel.retention.phase = CHANNEL_RETENTION_PHASE.ACTIVE;
      channel.retention.terminalStatus = "";
      channel.retention.cleanupAfterMs = 0;
    } else if (
      [
        CONVERSATION_STATE.COMPLETED,
        CONVERSATION_STATE.USER_STOPPED,
        CONVERSATION_STATE.ERROR,
      ].includes(nextState)
    ) {
      const channelSessionId = this._extractSessionIdFromChannelKey(channel.key);
      const eventOwnsChannel = !sessionId || sessionId === channelSessionId;
      if (eventOwnsChannel) {
        let clearedPendingInteractionCount = 0;
        for (const [requestId, envelope] of channel.pendingInteractionRequests.entries()) {
          const interaction = envelope?.payload || {};
          const sameSession =
            !sessionId || String(envelope?.identity?.sessionId || "").trim() === sessionId;
          const sameDialog =
            !dialogProcessId ||
            String(interaction.dialogProcessId || "").trim() === dialogProcessId;
          const sameTurn =
            !turnScopeId || String(envelope?.identity?.turnScopeId || "").trim() === turnScopeId;
          if (sameSession && sameDialog && sameTurn) {
            channel.pendingInteractionRequests.delete(requestId);
            this.requestChannelMap.delete(requestId);
            clearedPendingInteractionCount += 1;
          }
        }
        this.logSessionEvent(channel, {
          category: "interaction",
          event: "agentProxy.interaction.terminalCleanup",
          sessionId,
          dialogProcessId,
          turnScopeId,
          data: {
            lifecycleEventType: eventName,
            terminalState: nextState,
            clearedPendingInteractionCount,
            remainingPendingInteractionCount: channel.pendingInteractionRequests.size,
          },
        });
        this.markChannelTerminal(
          channel,
          nextState === CONVERSATION_STATE.COMPLETED ? CHANNEL_STATUS.DONE : nextState,
        );
      }
    }
    this.updateConversationState(channel, {
      dialogProcessId,
      turnScopeId,
      state: nextState,
      sourceEvent: eventName,
      seq,
      createdAtMs,
      sessionId,
      requestId: String(lifecycle?.requestId || "").trim(),
      broadcast: false,
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
