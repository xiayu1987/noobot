/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { vi } from "vitest";
import { useChatEngine } from "../../../../../src/composables/chat/useChatEngine";
import { createSessionDetailApplicator } from "../../../../../src/composables/chat/chatList/sessionDetailApply";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../../src/shared/constants/chatConstants";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/composables/chat/sessionRunStateMachine";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
  resolveSessionTurnRuntime,
  selectSessionTurnRuntime,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";

const terminalResolutionFromUrl = (url, state = "completed", messages = []) => {
  const match = String(url).match(/\/session\/[^/]+\/([^/]+)\/turns\/([^/]+)\/terminal/);
  const sessionId = decodeURIComponent(match?.[1] || "");
  const turnScopeId = decodeURIComponent(match?.[2] || "");
  const revision = 2;
  const sequence = 2;
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
    if (result?.applied !== false) turnRuntimeRegistry.value = { ...registry };
    return result;
  };

  const appendMessage = vi.fn((role, content = "", attachments = []) => {
    const message = makeMessage(role, content, attachments);
    activeSession.value.messages.push(message);
    activeSession.value.rawMessages.push(message);
    activeSession.value.messageCount = activeSession.value.messages.length;
    activeSession.value.lastMessage = message;
    return message;
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
    input,
    uploadFiles,
    clearUploads: vi.fn(),
    serializeAttachments: vi.fn(async () => []),
    appendMessage,
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
      clearStopRequested: vi.fn(),
      isStopRequested: vi.fn(() => false),
    },
    ensureConnected: vi.fn(() => true),
    notify: vi.fn(),
    terminalResolutionFetcher: vi.fn(async (url) => ({
      ok: true,
      json: async () => terminalResolutionFromUrl(
        url,
        terminalResolutionState,
        JSON.parse(JSON.stringify(activeSession.value?.rawMessages || [])),
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
} = {}) => {
  const registry = turnRuntimeRegistry.value;
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    sessionId,
    turnScopeId,
  });
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    sessionId,
    turnScopeId,
    dialogProcessId,
    state: BackendChannelState.SENDING,
  });
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
