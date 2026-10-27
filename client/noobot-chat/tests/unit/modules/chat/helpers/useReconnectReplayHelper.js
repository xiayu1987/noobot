/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { vi } from "vitest";
import { useReconnectReplay } from "../../../../../src/modules/chat/composables/useReconnectReplay.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyTurnLifecycleSnapshot,
  createTurnRuntimeRegistryState,
  selectCurrentTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { activate as activateWorkflowFrontend } from "../../../../../../../plugin/noobot-plugin-workflow/frontend/index.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
  getEventFamily,
} from "@noobot/event-protocol";
import {
  isTransientMessageEventType,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
  TRANSIENT_MESSAGE_EVENT_SEQUENCE,
} from "@noobot/event-protocol/message-event";
import { workflowSequenceDomainForEvent } from "@noobot/event-protocol/workflow-runtime-event";
import { createSessionMessageView } from "../../../../../src/modules/chat/runtime/session/messageView.js";
import { buildViewMessage } from "../../../../../src/modules/chat/model/messageModel.js";

function createSession(id) {
  return {
    id,
    sessionId: id,
    title: `session-${id}`,
    loaded: true,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    messageCount: 0,
    lastMessage: null,
    updatedAt: "",
  };
}

export function createCanonicalAssistant({
  dialogProcessId = "dp-1",
  presentationMessageId = `message-${dialogProcessId}`,
  turnScopeId = `turn-${dialogProcessId}`,
  sessionId = "s-1",
  content = "",
  ...extra
} = {}) {
  return buildViewMessage(
    {
      presentationMessageId,
      role: RoleEnum.ASSISTANT,
      sessionId,
      dialogProcessId,
      turnScopeId,
      content,
      pending: true,
      terminalOutcome: "",
      realtimeLogs: [],
      ...extra,
    },
    { sessionId: "s-1" },
  );
}

export function createAuthoritativeMessageEnvelope(
  eventType,
  {
    presentationMessageId,
    sessionId = "s-1",
    dialogProcessId,
    turnScopeId,
    seq = 1,
    eventId,
    ...eventData
  } = {},
) {
  if (Object.hasOwn(eventData, "messageId")) {
    throw new TypeError("messageId is not a message event field");
  }
  const normalizedDialogProcessId = dialogProcessId ?? "dp-1";
  const normalizedPresentationMessageId =
    presentationMessageId ?? `message-${normalizedDialogProcessId}`;
  const normalizedTurnScopeId = turnScopeId ?? `turn-${normalizedDialogProcessId}`;

  const sequence = Number(seq || 0);
  const orderingSequence = isTransientMessageEventType(eventType)
    ? TRANSIENT_MESSAGE_EVENT_SEQUENCE
    : sequence;
  const envelope = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: eventId ?? `${normalizedPresentationMessageId}-${eventType}-${sequence}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId,
      turnScopeId: normalizedTurnScopeId,
    },
    causality: {},
    ordering: {
      domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
      scopeId: normalizedPresentationMessageId,
      sequence: orderingSequence,
    },
    producer: { type: "test", id: "client-reconnect-fixture" },
    occurredAt: `2026-01-01T00:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
    payload: {
      eventType,
      presentationMessageId: normalizedPresentationMessageId,
      dialogProcessId: normalizedDialogProcessId,
      ...eventData,
    },
  });
  return {
    event: MESSAGE_EVENT_WIRE_EVENT,
    data: envelope,
  };
}

export function createInteractionEnvelope(
  payload = {},
  { sessionId = "s-1", turnScopeId = "turn-interaction", sequence = 1, eventId } = {},
) {
  const requestId = payload.requestId ?? "request-1";
  return createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
    identity: {
      eventId: eventId ?? `${requestId}-event-${sequence}`,
      eventType: INTERACTION_EVENT_TYPE.REQUEST,
      sessionId,
      turnScopeId,
    },
    causality: {},
    ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence },
    producer: { type: "test", id: "client-reconnect-fixture" },
    occurredAt: `2026-01-01T00:01:${String(sequence % 60).padStart(2, "0")}.000Z`,
    payload: { ...payload, requestId },
  });
}

export function createWorkflowEnvelope(
  eventType,
  payload = {},
  { sessionId = "s-1", turnScopeId = "turn-workflow", sequence = 1, eventId, executionId },
) {
  const workflowRunId = payload.workflowRunId ?? "workflow-1";
  return createEventEnvelope({
    family: EVENT_FAMILY.WORKFLOW_RUNTIME,
    schemaVersion: getEventFamily(EVENT_FAMILY.WORKFLOW_RUNTIME).schemaVersion,
    identity: {
      eventId: eventId ?? `${workflowRunId}-${eventType}-${sequence}`,
      eventType,
      sessionId,
      turnScopeId,
      executionId,
    },
    causality: {},
    ordering: {
      domain: workflowSequenceDomainForEvent(eventType),
      scopeId: workflowRunId,
      sequence,
    },
    producer: { type: "test", id: "client-reconnect-fixture" },
    occurredAt: `2026-01-01T00:02:${String(sequence % 60).padStart(2, "0")}.000Z`,
    payload: { ...payload, workflowRunId, turnScopeId },
  });
}

export function createFixture({ activeId = "s-1", currentRun = null } = {}) {
  clearExtensionRegistry();
  void activateWorkflowFrontend({
    contributeExtension: (point, contribution) =>
      contributeExtension(point, { ...contribution, pluginId: "workflow" }),
    extensionPoints: EXTENSION_POINTS,
    services: {},
  });
  const s1 = createSession("s-1");
  const s2 = createSession("s-2");
  if (currentRun) s1.currentRun = { ...currentRun, sessionId: "s-1" };
  const sessions = ref([s1, s2]);
  const activeSessionId = ref(activeId);
  const activeSession = computed(() =>
    sessions.value.find((sessionItem) => sessionItem.sessionId === activeSessionId.value),
  );
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const runtimeView = computed(() =>
    selectSessionTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value),
  );
  const pendingInteractionRequest = ref(null);

  const clearPendingInteraction = vi.fn();
  const setPendingInteractionRequest = vi.fn((request) => {
    pendingInteractionRequest.value = request || null;
  });
  const applyAuthoritativeTurnSnapshot = vi.fn((snapshot) => {
    const result = applyTurnLifecycleSnapshot(turnRuntimeRegistry.value, snapshot);
    return result;
  });
  const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
  const reduceSubSessionMessageEvent = vi.fn(() => ({ applied: true }));
  const chatList = {
    fetchSessions: vi.fn(async () => {}),
    fetchSessionDetail: vi.fn(async (sessionId) => ({
      sessionId,
      sessions: sessions.value.filter((sessionItem) => sessionItem.sessionId === sessionId),
    })),
    applySessionDetail: vi.fn((detail) => {
      const index = sessions.value.findIndex(
        (sessionItem) => sessionItem.sessionId === detail.sessionId,
      );
      sessions.value[index] = { ...sessions.value[index], ...detail.sessions[0] };
    }),
    selectSession: vi.fn(async (sessionId) => {
      activeSessionId.value = sessionId;
    }),
  };

  const messageView = createSessionMessageView({
    sessions,
    activeSession,
    activeSessionId,
    userId: ref("u-1"),
    isImageMime: () => false,
  });
  const findMessageByViewKey = vi.fn(messageView.findMessageByViewKey);

  const api = useReconnectReplay({
    sessions,
    activeSession,
    chatList,
    findMessageByViewKey,
    findMessagesByPresentationId: messageView.findMessagesByPresentationId,
    materializeTurnPresentation: messageView.materializeTurnPresentation,
    makeViewMessage: messageView.makeViewMessage,
    clearPendingInteraction,
    setPendingInteractionRequest,
    sessionLogWebSocketClient: { log: vi.fn() },
    turnRuntimeRegistry,
    applyWorkflowRuntimeEvent,
    reduceSubSessionMessageEvent,
    applyTurnLifecycleSnapshot: applyAuthoritativeTurnSnapshot,
  });

  const applyCanonicalMessageEvent = (eventType, data = {}) => {
    const envelope = createAuthoritativeMessageEnvelope(eventType, data);
    return api.applyReconnectEvent(envelope.event, envelope.data);
  };

  return {
    api: { ...api, applyCanonicalMessageEvent },
    refs: {
      sessions,
      activeSession,
      activeSessionId,
      turnRuntimeRegistry,
      sending: computed(() => runtimeView.value.sending),
      canStop: computed(() => runtimeView.value.canStop),
      activeTurnRuntime: computed(() => {
        return selectCurrentTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value);
      }),
      pendingInteractionRequest,
    },
    mocks: {
      findMessageByViewKey,
      clearPendingInteraction,
      setPendingInteractionRequest,
      chatList,
      applyTurnLifecycleSnapshot: applyAuthoritativeTurnSnapshot,
      applyWorkflowRuntimeEvent,
      reduceSubSessionMessageEvent,
    },
  };
}
