/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { vi } from "vitest";
import { createTurnLifecycleEnvelope } from "@noobot/event-protocol";
import { createTurnReplacementCommit } from "@noobot/shared/turn-replacement-protocol";
import { useChatEngine } from "../../../../../src/modules/chat/composables/useChatEngine.js";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../../src/modules/chat/model/chatConstants.js";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnLifecycleEnvelope,
  applyTurnRuntimeEvent,
  applyTurnTerminalResolution,
  createTurnRuntimeRegistryState,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { projectTurnRuntimeToMessages } from "../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";

const terminalResolutionFromUrl = (
  url,
  state = "completed",
  messages = [],
  { revision = 2, sequence = revision } = {},
) => {
  const match = String(url).match(/\/session\/[^/]+\/([^/]+)\/turns\/([^/]+)\/terminal/);
  const sessionId = decodeURIComponent(match?.[1] || "");
  const turnScopeId = decodeURIComponent(match?.[2] || "");
  const completionCommitId = `commit:${sessionId}:${turnScopeId}:${revision}`;
  const failure = state.endsWith("_failed")
    ? { stage: state.slice(0, -"_failed".length), retryable: false, message: "terminal failure" }
    : null;
  return {
    protocolVersion: 1,
    eventType: "turn.terminal_resolved",
    commandId: `resolve:${sessionId}:${turnScopeId}`,
    sessionId,
    turnScopeId,
    resolved: true,
    retryable: false,
    reason: "",
    retryAfterMs: 0,
    turn: {
      sessionId,
      turnScopeId,
      state,
      phase: state === "stop_completed" ? "stop" : (failure?.stage || "completion"),
      revision,
      sequence,
      completionCommitId,
      summaryVersion: 1,
      finalizeIntent: state === "stop_completed" ? "stop" : "complete",
      failure,
    },
    materialization: {
      sessionVersion: 1,
      terminalStatus: { status: state },
      messages,
      completionCommitId,
      summaryVersion: 1,
      revision,
      sequence,
    },
  };
};

vi.mock("../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: ref("zh-CN"),
    translate: (key) => key,
  }),
}));

export const makeSession = (id, overrides = {}) => ({
  id,
  backendSessionId: id,
  title: "chat.newSession",
  loaded: false,
  messages: [],
  rawMessages: [],
  sessionDocs: [],
  connectorPanelState: { selectedConnectors: {} },
  messageCount: 0,
  lastMessage: null,
  updatedAt: "",
  ...overrides,
});

export function makeTurnReplacementResponse({
  commandId,
  sessionId,
  version,
  replacedTurnScopeIds,
  replacementUser,
  messages = [replacementUser],
  session = {},
}) {
  const committedSession = {
    ...session,
    sessionId,
    version,
    messages,
  };
  return {
    ok: true,
    session: committedSession,
    turnReplacement: createTurnReplacementCommit({
      commandId,
      sessionId,
      committedVersion: version,
      replacedTurnScopeIds,
      replacementTurnScopeId: replacementUser.turnScopeId,
      replacementUserMessageId: replacementUser.messageId,
      committedAt: "2026-07-31T00:00:00.000Z",
    }),
  };
}

export const makeMessage = (role, content = "", attachments = []) => ({
  role,
  content,
  attachments,
  pending: false,
  statusLabel: "",
  realtimeLogs: [],
  executionLogTotal: 0,
  tool_calls: [],
});

let currentStreamTurnScopeId = "";

export const createHarness = ({
  sessionId,
  stream,
  pendingInteraction = null,
  interactionSubmittingValue = false,
  autoPatchStreamTurnScopeId = true,
  terminalResolutionState = "completed",
  terminalResolutionRevision = 2,
  terminalResolutionSequence = terminalResolutionRevision,
  deps = {},
} = {}) => {
  const activeSessionId = ref(sessionId);
  const sessions = ref([makeSession(sessionId)]);
  const activeSession = computed({
    get: () => sessions.value.find((item) =>
      [item?.id, item?.sessionId, item?.backendSessionId].includes(activeSessionId.value)) || null,
    set: (value) => {
      const index = sessions.value.findIndex((item) =>
        [item?.id, item?.sessionId, item?.backendSessionId].includes(activeSessionId.value));
      if (index < 0) sessions.value.push(value);
      else sessions.value[index] = value;
    },
  });
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const runtimeView = computed(() => selectSessionTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value));
  const sending = computed(() => runtimeView.value.sending);
  const canStop = computed(() => runtimeView.value.canStop);
  const activeTurnRuntime = computed(() => {
    return resolveSessionTurnRuntime(turnRuntimeRegistry.value, activeSessionId.value);
  });
  const input = ref("hello");
  const uploadFiles = ref([]);
  const pendingInteractionRequest = ref(pendingInteraction);
  const interactionSubmitting = ref(interactionSubmittingValue);
  const commitTurnRuntimeEvent = (event) => {
    const registry = turnRuntimeRegistry.value;
    const result = applyTurnRuntimeEvent(registry, event);
    if (result?.applied !== false) {
      turnRuntimeRegistry.value = { ...registry };
      projectTurnRuntimeToMessages({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        turn: result?.turn || event,
      });
    }
    return result;
  };
  const commitTurnLifecycleEnvelope = (envelope) => {
    const registry = turnRuntimeRegistry.value;
    const result = applyTurnLifecycleEnvelope(registry, envelope);
    if (result?.applied !== false) {
      turnRuntimeRegistry.value = { ...registry };
    }
    return result;
  };
  const commitTurnTerminalResolution = (response) => {
    const registry = turnRuntimeRegistry.value;
    const result = applyTurnTerminalResolution(registry, response);
    if (result?.applied !== false) {
      turnRuntimeRegistry.value = { ...registry };
      projectTurnRuntimeToMessages({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        turn: result?.turn || response?.turn || response,
      });
    }
    return result;
  };

  const appendMessage = vi.fn((role, content = "", attachments = [], options = {}) => {
    const message = { ...makeMessage(role, content, attachments), ...options };
    activeSession.value.messages.push(message);
    activeSession.value.rawMessages.push(message);
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = message;
    return message;
  });

  const upsertCanonicalAssistantMessage = vi.fn((messageId, identity = {}) => {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) return null;
    const existing = activeSession.value.messages.find((message) => (
      String(message?.messageId || message?.id || "").trim() === normalizedMessageId
    ));
    if (existing) return existing;
    const message = appendMessage(RoleEnum.ASSISTANT, "", [], {
      ...identity,
      id: normalizedMessageId,
      messageId: normalizedMessageId,
    });
    Object.assign(message, identity, {
      id: normalizedMessageId,
      messageId: normalizedMessageId,
    });
    return message;
  });

  const findCanonicalMessageById = vi.fn((targetSessionId, messageId) => {
    const normalizedSessionId = String(targetSessionId || "").trim();
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedSessionId || !normalizedMessageId) return null;
    const targetSession = sessions.value.find((sessionItem) => [
      sessionItem?.id,
      sessionItem?.sessionId,
      sessionItem?.backendSessionId,
    ].some((candidate) => String(candidate || "").trim() === normalizedSessionId));
    return targetSession?.messages?.find((message) => (
      String(message?.messageId || message?.id || "").trim() === normalizedMessageId
    )) || null;
  });

  const defaultDeps = {
    userId: ref("u-1"),
    allowUserInteraction: ref(true),
    safeConfirm: ref(true),
    botScenario: ref(""),
    isImageMime: () => false,
    classifyRealtimeLog: (d) => d,
    scrollBottom: vi.fn(),
    activeSession,
    activeSessionId,
    sessions,
    turnRuntimeRegistry,
    applyTurnRuntimeEvent: commitTurnRuntimeEvent,
    applyTurnLifecycleEnvelope: commitTurnLifecycleEnvelope,
    commitTurnTerminalResolution,
    input,
    uploadFiles,
    clearUploads: vi.fn(),
    serializeAttachments: vi.fn(async () => []),
    appendMessage,
    findCanonicalMessageById,
    upsertCanonicalAssistantMessage,
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (messages) => [...messages],
    fetchSessionDetail: vi.fn(async () => ({})),
    applySessionDetail: vi.fn(),
    refreshSessionConnectorsAsync: vi.fn(),
    connectorTypeSet: new Set(),
    upsertConnectedConnectorInPanelState: vi.fn(),
    pendingInteractionRequest,
    interactionSubmitting,
    clearPendingInteraction: vi.fn(() => {
      pendingInteractionRequest.value = null;
    }),
    clearPendingInteractionIfObsolete: vi.fn(),
    setPendingInteractionRequest: vi.fn(),
    submitInteractionResponse: vi.fn(),
    refreshSessionsAsync: vi.fn(),
    chatWebSocketClient: {
      stream: stream
        ? vi.fn(async (payload, onEvent) => {
            currentStreamTurnScopeId = String(payload?.turnScopeId || "").trim();
            const wrappedOnEvent = (envelope = {}) => {
              const data = envelope?.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
                ? envelope.data
                : null;
              if (
                autoPatchStreamTurnScopeId &&
                data &&
                data.turnScopeId === undefined &&
                String(data?.dialogProcessId || "").trim()
              ) {
                onEvent({ ...envelope, data: { ...data, turnScopeId: currentStreamTurnScopeId } });
                return;
              }
              onEvent(envelope);
            };
            try {
              return await stream(payload, wrappedOnEvent);
            } finally {
              currentStreamTurnScopeId = "";
            }
          })
        : vi.fn(),
      requestStop: vi.fn(),
      clearLastReceivedSeqMap: vi.fn(),
      dispose: vi.fn(),
    },
    sessionLogWebSocketClient: { log: vi.fn() },
    ensureConnected: vi.fn(() => true),
    notify: vi.fn(),
    terminalResolutionFetcher: vi.fn(async (url) => ({
      ok: true,
      json: async () => terminalResolutionFromUrl(
        url,
        terminalResolutionState,
        JSON.parse(JSON.stringify(activeSession.value?.rawMessages || [])),
        {
          revision: terminalResolutionRevision,
          sequence: terminalResolutionSequence,
        },
      ),
    })),
  };

  const resolvedDeps = { ...defaultDeps, ...deps };
  const engine = useChatEngine(resolvedDeps);

  return {
    engine,
    deps: resolvedDeps,
    activeSession,
    activeSessionId,
    sessions,
    sending,
    canStop,
    activeTurnRuntime,
    turnRuntimeRegistry,
    input,
    uploadFiles,
    pendingInteractionRequest,
    interactionSubmitting,
    appendMessage,
  };
};

export const activateRuntimeTurn = ({
  turnRuntimeRegistry,
  sessionId,
  turnScopeId,
  dialogProcessId = "",
  userId = "u-1",
  commandId = `send:${turnScopeId}`,
  messageId = `event-message:${turnScopeId}`,
  presentationMessageId = `message:${turnScopeId}`,
  revision = 1,
  sequence = 1,
} = {}) => {
  const registry = turnRuntimeRegistry.value;
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    sessionId,
    turnScopeId,
  });
  applyTurnLifecycleEnvelope(registry, createTurnLifecycleEnvelope({
    eventType: "turn.action_accepted",
    eventId: `accepted:${sessionId}:${turnScopeId}:${revision}`,
    commandId,
    userId,
    sessionId,
    turnScopeId,
    messageId,
    presentationMessageId,
    dialogProcessId,
    revision,
    sequence,
    phase: "action",
    state: "action_requesting",
    action: "send",
    executionState: "accepted",
    capabilities: { actionLocked: true, canStop: false },
  }));
  applyTurnLifecycleEnvelope(registry, createTurnLifecycleEnvelope({
    eventType: "turn.processing_started",
    eventId: `processing:${sessionId}:${turnScopeId}:${revision + 1}`,
    commandId,
    userId,
    sessionId,
    turnScopeId,
    messageId,
    presentationMessageId,
    dialogProcessId,
    revision: revision + 1,
    sequence: sequence + 1,
    phase: "processing",
    state: "processing",
    action: "send",
    executionState: "sending",
    capabilities: { actionLocked: true, canStop: true },
  }));
  turnRuntimeRegistry.value = { ...registry };
};

export const assistantMessage = (activeSession) =>
  activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT);

export const emitChannelState = (onEvent, sessionId, dialogProcessId, state, data = {}) => {
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const turnScopePatch =
    data?.turnScopeId !== undefined || !normalizedDialogProcessId
      ? {}
      : { turnScopeId: currentStreamTurnScopeId };
  onEvent({
    event: StreamEventEnum.CHANNEL_STATE,
    data: { sessionId, dialogProcessId, state, ...turnScopePatch, ...data },
  });
};

export const emitAuthorityProcessing = (onEvent, {
  sessionId,
  turnScopeId,
  dialogProcessId = "",
  userId = "u-1",
  commandId = `send:${turnScopeId}`,
  messageId = `event-message:${turnScopeId}`,
  presentationMessageId = `message:${turnScopeId}`,
} = {}) => {
  const emit = (data) => onEvent({ event: StreamEventEnum.TURN_LIFECYCLE, data });
  emit(createTurnLifecycleEnvelope({
    eventType: "turn.action_accepted",
    eventId: `accepted:${sessionId}:${turnScopeId}`,
    commandId,
    userId,
    sessionId,
    turnScopeId,
    messageId,
    presentationMessageId,
    dialogProcessId,
    revision: 1,
    sequence: 1,
    phase: "action",
    state: "action_requesting",
    action: "send",
    executionState: "accepted",
    capabilities: { actionLocked: true, canStop: false },
  }));
  emit(createTurnLifecycleEnvelope({
    eventType: "turn.processing_started",
    eventId: `processing:${sessionId}:${turnScopeId}`,
    commandId,
    userId,
    sessionId,
    turnScopeId,
    messageId,
    presentationMessageId,
    dialogProcessId,
    revision: 2,
    sequence: 2,
    phase: "processing",
    state: "processing",
    action: "send",
    executionState: "sending",
    capabilities: { actionLocked: true, canStop: true },
  }));
};

export const emitAuthorityCompletionRequested = (onEvent, {
  sessionId,
  turnScopeId,
  dialogProcessId = "",
  userId = "u-1",
  commandId = `send:${turnScopeId}`,
  messageId = `event-message:${turnScopeId}`,
  presentationMessageId = `message:${turnScopeId}`,
} = {}) => {
  onEvent({
    event: StreamEventEnum.TURN_LIFECYCLE,
    data: createTurnLifecycleEnvelope({
      eventType: "turn.processing_completed",
      eventId: `completion-requested:${sessionId}:${turnScopeId}`,
      commandId,
      userId,
      sessionId,
      turnScopeId,
      messageId,
      presentationMessageId,
      dialogProcessId,
      revision: 3,
      sequence: 3,
      phase: "completion",
      state: "completion_requesting",
      action: "send",
      executionState: "completing",
      capabilities: { actionLocked: true, canStop: false },
    }),
  });
};

export const emitAuthorityTerminal = (onEvent, {
  sessionId,
  turnScopeId,
  dialogProcessId = "",
  userId = "u-1",
  commandId = `send:${turnScopeId}`,
  messageId = `event-message:${turnScopeId}`,
  presentationMessageId = `message:${turnScopeId}`,
  state = "completed",
  sequence = 3,
  revision = 3,
  failure = null,
} = {}) => {
  onEvent({
    event: StreamEventEnum.TURN_LIFECYCLE,
    data: createTurnLifecycleEnvelope({
      eventType: state === "stop_completed" ? "turn.stop_completed" : (
        failure ? "turn.failed" : "turn.completed"
      ),
      eventId: `terminal:${sessionId}:${turnScopeId}:${sequence}`,
      commandId,
      userId,
      sessionId,
      turnScopeId,
      messageId,
      presentationMessageId,
      dialogProcessId,
      revision,
      sequence,
      phase: state === "stop_completed" ? "stop" : "completion",
      state,
      action: state === "stop_completed" ? "stop" : "send",
      executionState: "completed",
      completionCommitId: `commit:${sessionId}:${turnScopeId}:${revision}`,
      summaryVersion: revision,
      failure,
      capabilities: { actionLocked: false, canStop: false },
    }),
  });
};
