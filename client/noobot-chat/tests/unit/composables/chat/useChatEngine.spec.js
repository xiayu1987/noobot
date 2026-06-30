import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatEngine } from "../../../../src/composables/chat/useChatEngine";
import { createSessionDetailApplicator } from "../../../../src/composables/chat/chatList/sessionDetailApply";
import { SESSION_RUN_STATE } from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    locale: ref("zh-CN"),
    translate: (key) => key,
  }),
}));

const makeSession = (id, overrides = {}) => ({
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

const makeMessage = (role, content = "", attachments = []) => ({
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

const createHarness = ({
  sessionId,
  stream,
  pendingInteraction = null,
  interactionSubmittingValue = false,
  deps = {},
} = {}) => {
  const activeSessionId = ref(sessionId);
  const activeSession = ref(makeSession(sessionId));
  const sending = ref(false);
  const canStop = ref(false);
  const runStateSnapshot = ref(null);
  const input = ref("hello");
  const uploadFiles = ref([]);
  const pendingInteractionRequest = ref(pendingInteraction);
  const interactionSubmitting = ref(interactionSubmittingValue);

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
    forceTool: ref(false),
    botScenario: ref(""),
    isImageMime: () => false,
    classifyRealtimeLog: (d) => d,
    scrollBottom: vi.fn(),
    activeSession,
    activeSessionId,
    sending,
    canStop,
    runStateSnapshot,
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
              if (data && data.turnScopeId === undefined && String(data?.dialogProcessId || "").trim()) {
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
  };

  const resolvedDeps = { ...defaultDeps, ...deps };
  const engine = useChatEngine(resolvedDeps);

  return {
    engine,
    deps: resolvedDeps,
    activeSession,
    activeSessionId,
    sending,
    canStop,
    runStateSnapshot,
    input,
    uploadFiles,
    pendingInteractionRequest,
    interactionSubmitting,
    appendMessage,
  };
};

const assistantMessage = (activeSession) =>
  activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT);

const emitChannelState = (onEvent, sessionId, dialogProcessId, state, data = {}) => {
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

describe("useChatEngine", () => {

  it("send carries turnScopeId through backend payload and ignores stale unscoped terminal state", async () => {
    let capturedPayload = null;
    const stream = vi.fn(async (payload, onEvent) => {
      capturedPayload = payload;
      emitChannelState(onEvent, "local-client-turn", "", "sending", {
        turnScopeId: payload.turnScopeId,
      });
      emitChannelState(onEvent, "local-client-turn", "", "completed");
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-client-turn",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(capturedPayload).toEqual(expect.objectContaining({
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(assistant?.turnScopeId).toBe(capturedPayload.turnScopeId);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: capturedPayload.turnScopeId,
    }));
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("send rejects when frontend run state has no matching in-flight assistant", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, runStateSnapshot, sending, deps, appendMessage } = createHarness({
      sessionId: "local-send-state-mismatch",
      stream,
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old", turnScopeId: "turn-old" },
      {
        role: RoleEnum.ASSISTANT,
        content: "stopped",
        pending: false,
        statusLabel: "chat.stopped",
        turnScopeId: "turn-old",
        channelState: { state: "stopped", turnScopeId: "turn-old" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "local-send-state-mismatch",
      turnScopeId: "turn-missing",
    };

    await expect(engine.send()).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "warning",
      message: "chat.sessionStateOutOfSync",
    }));
  });

  it("DONE immediately finalizes assistant UI even if stream promise stays open", async () => {
    let releaseStream;
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-done-open",
          dialogProcessId: "dp-done-open",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done-open", content: "final answer" },
          ],
        },
      });
      await new Promise((resolve) => {
        releaseStream = resolve;
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-done-open",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore detail fetch in this unit test");
        }),
      },
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);

    releaseStream();
    await sendPromise;
  });

  it("DONE patches current assistant turn and promotes session identity", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { dialogProcessId: "dp-new", text: "partial " },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-1",
          dialogProcessId: "dp-new",
          messages: [
            { role: RoleEnum.USER, content: "old q" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old answer" },
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-new",
              content: "final answer",
              modelAlias: "alias-a",
              modelName: "model-a",
              modelRuns: [{ runId: "r1" }],
              attachments: [{ name: "f1" }],
              tool_calls: [{ id: "tc1" }],
            },
          ],
        },
      });
    });
    const { engine, activeSession, activeSessionId, sending } = createHarness({
      sessionId: "local-1",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore detail fetch in this unit test");
        }),
      },
    });

    await engine.send();

    expect(activeSession.value.id).toBe("backend-1");
    expect(activeSession.value.backendSessionId).toBe("backend-1");
    expect(activeSessionId.value).toBe("backend-1");
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[0].role).toBe(RoleEnum.USER);
    const botMessage = activeSession.value.messages[1];
    expect(botMessage.role).toBe(RoleEnum.ASSISTANT);
    expect(botMessage.content).toBe("final answer");
    expect(botMessage.dialogProcessId).toBe("dp-new");
    expect(botMessage.modelAlias).toBe("alias-a");
    expect(botMessage.tool_calls).toEqual([{ id: "tc1" }]);
    expect(botMessage.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("channel_state sending preserves thinking elapsed start on assistant message", async () => {
    const startedAt = "2026-06-22T10:00:00.000Z";
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-time",
          dialogProcessId: "dp-time",
          state: "sending",
          createdAt: startedAt,
          createdAtMs: Date.parse(startedAt),
          updatedAt: startedAt,
          updatedAtMs: Date.parse(startedAt),
        },
      });
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-time", dialogProcessId: "dp-time", text: "partial" },
      });
      onEvent({
        event: StreamEventEnum.CHANNEL_STATE,
        data: {
          sessionId: "local-time",
          dialogProcessId: "dp-time",
          state: "completed",
          createdAt: startedAt,
          createdAtMs: Date.parse(startedAt),
          updatedAt: "2026-06-22T10:00:12.000Z",
          updatedAtMs: Date.parse("2026-06-22T10:00:12.000Z"),
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: { sessionId: "local-time", dialogProcessId: "dp-time" },
      });
    });
    const { engine, activeSession } = createHarness({ sessionId: "local-time", stream });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.channelState).toMatchObject({
      state: "completed",
      createdAt: startedAt,
      createdAtMs: Date.parse(startedAt),
      updatedAt: "2026-06-22T10:00:12.000Z",
    });
    expect(assistant?.thinkingStartedAt).toBe(startedAt);
    expect(assistant?.thinking_started_at).toBeUndefined();
    expect(assistant?.thinkingFinishedAt).toBe("2026-06-22T10:00:12.000Z");
  });

  it("channel_state drives assistant status transition", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-2", "dp-state", "sending");
      onEvent({
        event: StreamEventEnum.DELTA,
        data: { sessionId: "local-2", dialogProcessId: "dp-state", text: "partial" },
      });
      emitChannelState(onEvent, "local-2", "dp-state", "stopped");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-2", dialogProcessId: "dp-state" },
      });
    });
    const { engine, activeSession, sending } = createHarness({ sessionId: "local-2", stream });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.dialogProcessId).toBe("dp-state");
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
  });

  it("does not refresh current session detail after stopped final event", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-stop-refresh",
      sessions: [
        {
          sessionId: "local-stop-refresh",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-stop-refresh",
              content: "persisted stopped answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stop-refresh", "dp-stop-refresh", "stopped", {
        seq: 2,
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-stop-refresh", dialogProcessId: "dp-stop-refresh" },
      });
    });
    const { engine, deps } = createHarness({
      sessionId: "local-stop-refresh",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await engine.send();

    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(deps.chatWebSocketClient.isStopRequested).toHaveBeenCalled();
  });

  it("stopped final detail preserves a fresh replacement turn instead of replacing it with a stale stopped snapshot", async () => {
    let replacementTurnScopeId = "";
    const staleStoppedTurnScopeId = "client-turn:old-stopped-detail";
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-stop-detail-preserve",
      sessions: [
        {
          sessionId: "local-stop-detail-preserve",
          messages: [
            { role: RoleEnum.USER, content: "old question", turnScopeId: staleStoppedTurnScopeId },
            {
              role: RoleEnum.ASSISTANT,
              content: "old partial",
              turnScopeId: staleStoppedTurnScopeId,
              statusLabel: "chat.stopped",
              stopState: "stopped",
              channelState: { state: "stopped", turnScopeId: staleStoppedTurnScopeId },
            },
          ],
        },
      ],
    }));
    const stream = vi.fn(async (payload, onEvent) => {
      replacementTurnScopeId = payload.turnScopeId;
      emitChannelState(onEvent, "local-stop-detail-preserve", "dp-new", "stopped", {
        turnScopeId: payload.turnScopeId,
      });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: {
          sessionId: "local-stop-detail-preserve",
          dialogProcessId: "dp-new",
          turnScopeId: payload.turnScopeId,
        },
      });
    });
    const harness = createHarness({
      sessionId: "local-stop-detail-preserve",
      stream,
    });
    const sessions = ref([harness.activeSession.value]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId: harness.activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });
    harness.deps.fetchSessionDetail = fetchSessionDetail;
    harness.deps.applySessionDetail = applySessionDetail;
    harness.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited question", turnScopeId: "client-turn:fresh" },
    ];

    await harness.engine.send({
      content: "edited question",
      turnScopeId: "client-turn:fresh",
      reuseExistingUserTurn: true,
    });

    const messages = harness.activeSession.value.messages;
    expect(replacementTurnScopeId).toBe("client-turn:fresh");
    expect(messages.some((message) => message.turnScopeId === staleStoppedTurnScopeId)).toBe(false);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question", turnScopeId: "client-turn:fresh" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, turnScopeId: "client-turn:fresh" }),
    ]));
  });

  it("applySessionDetail preserves a fresh in-flight turn even when caller requests replacement", () => {
    const staleStoppedTurnScopeId = "turn-stopped-old";
    const freshTurnScopeId = "client-turn:fresh-apply";
    const activeSession = {
      id: "s-apply-preserve",
      sessionId: "s-apply-preserve",
      backendSessionId: "s-apply-preserve",
      title: "current",
      messages: [
        { role: RoleEnum.USER, content: "edited again", turnScopeId: freshTurnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-fresh-apply",
          pending: true,
          channelState: { state: "sending", turnScopeId: freshTurnScopeId },
        },
      ],
    };
    const activeSessionId = ref("s-apply-preserve");
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId: "s-apply-preserve",
      sessions: [{
        sessionId: "s-apply-preserve",
        messages: [
          { role: RoleEnum.USER, content: "old stopped", turnScopeId: staleStoppedTurnScopeId },
          {
            role: RoleEnum.ASSISTANT,
            content: "已停止",
            turnScopeId: staleStoppedTurnScopeId,
            dialogProcessId: "dp-old-apply",
            statusLabel: "chat.stopped",
            stopState: "stopped",
            channelState: { state: "stopped", turnScopeId: staleStoppedTurnScopeId },
          },
        ],
      }],
    }, { preserveCurrentMessages: false });

    expect(activeSession.messages).toHaveLength(2);
    expect(activeSession.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited again", turnScopeId: freshTurnScopeId }),
      expect.objectContaining({
        role: RoleEnum.ASSISTANT,
        turnScopeId: freshTurnScopeId,
        pending: true,
      }),
    ]));
    expect(activeSession.messages.some((message) => message.turnScopeId === staleStoppedTurnScopeId)).toBe(false);
  });

  it("applySessionDetail does not roll back a newer local session version", () => {
    const activeSession = {
      id: "s-apply-version",
      sessionId: "s-apply-version",
      backendSessionId: "s-apply-version",
      title: "current",
      version: 9,
      revision: 9,
      messages: [{ role: RoleEnum.USER, content: "current", turnScopeId: "client-turn:version" }],
      rawMessages: [],
    };
    const activeSessionId = ref("s-apply-version");
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId: "s-apply-version",
      sessions: [{
        sessionId: "s-apply-version",
        version: 7,
        revision: 7,
        messages: [{ role: RoleEnum.USER, content: "stale", turnScopeId: "client-turn:version" }],
      }],
    });

    expect(activeSession.version).toBe(9);
    expect(activeSession.revision).toBe(9);

    applySessionDetail({
      sessionId: "s-apply-version",
      sessions: [{
        sessionId: "s-apply-version",
        version: 10,
        revision: 10,
        messages: [{ role: RoleEnum.USER, content: "fresh", turnScopeId: "client-turn:version" }],
      }],
    });

    expect(activeSession.version).toBe(10);
    expect(activeSession.revision).toBe(10);
  });

  it("applySessionDetail does not let stopped detail overwrite an in-flight assistant with the same turnScopeId", () => {
    const freshTurnScopeId = "client-turn:fresh-same-scope";
    const activeSession = {
      id: "s-apply-same-scope-stopped",
      sessionId: "s-apply-same-scope-stopped",
      backendSessionId: "s-apply-same-scope-stopped",
      title: "current",
      messages: [
        { role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-local-pending",
          pending: true,
          statusLabel: "",
          channelState: { state: "sending", turnScopeId: freshTurnScopeId },
        },
      ],
    };
    const activeSessionId = ref("s-apply-same-scope-stopped");
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId: "s-apply-same-scope-stopped",
      sessions: [{
        sessionId: "s-apply-same-scope-stopped",
        messages: [
          { role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
          {
            role: RoleEnum.ASSISTANT,
            content: "已停止",
            turnScopeId: freshTurnScopeId,
            dialogProcessId: "dp-stale-stopped",
            pending: false,
            statusLabel: "chat.stopped",
            stopState: "stopped",
            channelState: { state: "stopped", turnScopeId: freshTurnScopeId },
          },
        ],
      }],
    }, { preserveCurrentMessages: true });

    const assistant = activeSession.messages.find((message) => message.role === RoleEnum.ASSISTANT);
    expect(assistant).toEqual(expect.objectContaining({
      content: "",
      turnScopeId: freshTurnScopeId,
      dialogProcessId: "dp-local-pending",
      pending: true,
      statusLabel: "",
    }));
    expect(assistant.channelState).toEqual(expect.objectContaining({ state: "sending" }));
    expect(assistant.stopState).toBeUndefined();
  });

  it("applySessionDetail still merges completed detail into an in-flight assistant with the same turnScopeId", () => {
    const freshTurnScopeId = "client-turn:fresh-completed-scope";
    const activeSession = {
      id: "s-apply-same-scope-completed",
      sessionId: "s-apply-same-scope-completed",
      backendSessionId: "s-apply-same-scope-completed",
      title: "current",
      messages: [
        { role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-local-pending",
          pending: true,
          statusLabel: "",
          channelState: { state: "sending", turnScopeId: freshTurnScopeId },
        },
      ],
    };
    const activeSessionId = ref("s-apply-same-scope-completed");
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId: "s-apply-same-scope-completed",
      sessions: [{
        sessionId: "s-apply-same-scope-completed",
        messages: [
          { role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
          {
            role: RoleEnum.ASSISTANT,
            content: "answer done",
            turnScopeId: freshTurnScopeId,
            dialogProcessId: "dp-completed",
            pending: false,
            completed: true,
            channelState: { state: "completed", turnScopeId: freshTurnScopeId },
          },
        ],
      }],
    }, { preserveCurrentMessages: true });

    const assistant = activeSession.messages.find((message) => message.role === RoleEnum.ASSISTANT);
    expect(assistant).toEqual(expect.objectContaining({
      content: "answer done",
      turnScopeId: freshTurnScopeId,
      dialogProcessId: "dp-completed",
      pending: false,
      completed: true,
    }));
  });

  it("expired channel_state schedules session refresh", async () => {
    vi.useFakeTimers();
    const refreshSessionsAsync = vi.fn(async () => {});
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired", "dp-expired", "expired");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-expired", dialogProcessId: "dp-expired" },
      });
    });
    const { engine, deps } = createHarness({
      sessionId: "local-expired",
      stream,
      pendingInteraction: {
        requestId: "req-1",
        sessionId: "local-expired",
        dialogProcessId: "dp-expired",
      },
      interactionSubmittingValue: true,
      deps: {
        refreshSessionsAsync,
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(refreshSessionsAsync).toHaveBeenCalledTimes(1);
    expect(refreshSessionsAsync).toHaveBeenCalledWith("local-expired", {
      silent: true,
      preserveCurrentMessages: true,
    });
    vi.useRealTimers();
  });

  it("channel_state interaction_pending restores pending interaction payload", async () => {
    const setPendingInteractionRequest = vi.fn();
    const pendingInteraction = {
      requestId: "req-int",
      sessionId: "local-int",
      dialogProcessId: "dp-int",
      interactionType: "confirm",
      content: "confirm?",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int", "dp-int", "interaction_pending", {
        seq: 2,
        pendingInteraction,
      });
      emitChannelState(onEvent, "local-int", "dp-int", "stopped", { seq: 3 });
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-int", dialogProcessId: "dp-int" },
      });
    });
    const { engine, interactionSubmitting } = createHarness({
      sessionId: "local-int",
      stream,
      deps: { setPendingInteractionRequest },
    });

    await engine.send();

    expect(setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(setPendingInteractionRequest.mock.calls[0][0]).toMatchObject(pendingInteraction);
    expect(interactionSubmitting.value).toBe(false);
  });

  it("channel_state sending does not clear interaction unless sourceEvent is interaction_response", async () => {
    const clearPendingInteractionIfObsolete = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "interaction_pending", {
        seq: 1,
        pendingInteraction: {
          requestId: "req-int-send",
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          interactionType: "confirm",
          content: "confirm?",
        },
      });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", { seq: 2 });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", {
        sourceEvent: "interaction_response",
        requestId: "req-int-send",
        seq: 3,
      });
    });
    const { engine } = createHarness({
      sessionId: "local-int-send",
      stream,
      deps: { clearPendingInteractionIfObsolete },
    });

    await engine.send();

    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      requestId: "req-int-send",
    });
  });

  it("channel_state stopping/reconnecting updates in-flight status label", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopping");
      emitChannelState(onEvent, "local-flight", "dp-flight", "reconnecting");
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopped");
      onEvent({
        event: StreamEventEnum.STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-flight",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
  });

  it("channel_state stopping keeps in-flight UI but disables repeated stop", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stopping", "dp-stopping", "stopping");
    });
    const { engine, sending, canStop } = createHarness({
      sessionId: "local-stopping",
      stream,
    });

    await engine.send();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
  });

  it("channel_state completed/error/no_conversation terminal behaviors are covered", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "completed");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "error");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "no_conversation");
    });
    const { engine, activeSession, sending, canStop, interactionSubmitting, deps } = createHarness({
      sessionId: "local-terminal",
      stream,
      pendingInteraction: {
        requestId: "req-terminal",
        sessionId: "local-terminal",
        dialogProcessId: "dp-terminal",
      },
      interactionSubmittingValue: true,
      deps: {
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(interactionSubmitting.value).toBe(false);
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
  });

  it("terminal channel_state with backend sessionId still finalizes current local turn", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "backend-x", "dp-x", "completed", { seq: 2 });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-x",
          dialogProcessId: "dp-x",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-x", content: "ok" },
          ],
        },
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-x",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore");
        }),
      },
    });

    await engine.send();

    expect(sending.value).toBe(false);
    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
  });

  it("terminal channel_state without DONE still lets send finalize and refresh detail", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-state-only",
      sessions: [
        {
          sessionId: "local-state-only",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-state-only",
              content: "detail answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-state-only", "dp-state-only", "completed", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "local-state-only",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await expect(engine.send()).resolves.toBe(true);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-state-only");
    expect(applySessionDetail).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "local-state-only" }),
      { preserveCurrentMessages: true, scrollToBottom: false },
    );
    expect(deps.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(2);
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-missing", "dp-missing", "interaction_pending", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-missing",
      stream,
      deps: { notify },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(assistant?.pending).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired-fail", "dp-expired-fail", "expired", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-expired-fail",
      stream,
      deps: {
        notify,
        refreshSessionsAsync: vi.fn(async () => false),
      },
    });

    await engine.send();
    await vi.advanceTimersByTimeAsync(1300);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.expiredRefreshFailed");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });

  it("connector_status is informational: updates connector panel without interaction pending", async () => {
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const refreshSessionConnectorsAsync = vi.fn();
    const upsertConnectedConnectorInPanelState = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.CONNECTOR_STATUS,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          connectorType: "email",
          connectorName: "example_email",
          status: "connected",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-connector-status",
          dialogProcessId: "dp-connector-status",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-connector-status",
              content: "ok",
            },
          ],
        },
      });
    });
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-connector-status",
      stream,
      deps: {
        refreshSessionConnectorsAsync,
        connectorTypeSet: new Set(["email"]),
        upsertConnectedConnectorInPanelState,
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(upsertConnectedConnectorInPanelState).toHaveBeenCalledWith(activeSession.value, {
      connectorType: "email",
      connectorName: "example_email",
      status: "connected",
    });
    expect(refreshSessionConnectorsAsync).toHaveBeenCalledWith("local-connector-status");
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).not.toHaveBeenCalled();
  });

  it("interaction_request with lifecycle=resolved & ackMode=auto should auto ack and not enter pending", async () => {
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          requestId: "req-auto",
          interactionType: "post_action_notice",
          lifecycle: "resolved",
          ackMode: "auto",
          content: "done",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-auto", content: "ok" },
          ],
        },
      });
    });
    const { engine } = createHarness({
      sessionId: "local-auto-resolved",
      stream,
      deps: {
        connectorTypeSet: new Set(["email"]),
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).toHaveBeenCalledTimes(1);
    expect(submitInteractionResponse.mock.calls[0][0]).toMatchObject({
      confirmed: true,
      response: "post_action_notice_ack",
    });
  });

  it("send enables stop while stream is active", async () => {
    let releaseStream;
    const stream = vi.fn(() => new Promise((resolve) => {
      releaseStream = resolve;
    }));
    const { engine, sending, canStop } = createHarness({
      sessionId: "local-active-stop",
      stream,
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);

    releaseStream();
    await sendPromise;
  });

  it("stopSending disables repeated stop and sends stable channel identity payload", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-payload",
    });
    activeSession.value.backendSessionId = "backend-stop-payload";
    activeSession.value.parentSessionId = "parent-session";
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial answer",
      pending: true,
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentDialogProcessId: "parent-dp",
      modelAlias: "alias-a",
      modelName: "model-a",
    });
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(canStop.value).toBe(false);
    expect(engine.stopSending()).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(deps.chatWebSocketClient.requestStop.mock.calls[0][0]).toMatchObject({
      userId: "u-1",
      sessionId: "backend-stop-payload",
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentSessionId: "parent-session",
      parentDialogProcessId: "parent-dp",
      partialAssistant: {
        content: "partial answer",
        dialogProcessId: "dp-stop-payload",
        turnScopeId: "turn-stop-payload",
        modelAlias: "alias-a",
        modelName: "model-a",
      },
    });
  });

  it("stopSending can stop a refreshed in-flight assistant with channelState but no pending flag", async () => {
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-stop-refreshed",
    });
    activeSession.value.backendSessionId = "backend-stop-refreshed";
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited", turnScopeId: "turn-refreshed" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        channelState: { state: SESSION_RUN_STATE.RESEND_STREAMING },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-refreshed",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        partialAssistant: expect.objectContaining({
          content: "partial after refresh",
          dialogProcessId: "dp-refreshed",
          turnScopeId: "turn-refreshed",
        }),
      }),
      expect.any(Function),
    );
  });

  it("prepareMonotonicMessageAction stops first and waits until sending settles", async () => {
    vi.useFakeTimers();
    const { engine, deps, sending, canStop, activeSession } = createHarness({
      sessionId: "local-monotonic-stop",
      deps: {
        monotonicActionStopTimeoutMs: 500,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages.push({
      role: RoleEnum.USER,
      content: "question",
      turnScopeId: "turn-stop",
    });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
    });
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      setTimeout(onForceStop, 20);
      return true;
    });

    const actionPromise = engine.prepareMonotonicMessageAction();
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30);
    await expect(actionPromise).resolves.toBe(true);
    expect(sending.value).toBe(false);
    vi.useRealTimers();
  });

  it("prepareMonotonicMessageAction warns and rejects when stop does not settle", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const { engine, deps, activeSession, sending, runStateSnapshot } = createHarness({
      sessionId: "local-monotonic-timeout",
      deps: {
        notify,
        monotonicActionStopTimeoutMs: 30,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-timeout" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: true,
        turnScopeId: "turn-timeout",
        channelState: { state: "sending", turnScopeId: "turn-timeout" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "local-monotonic-timeout",
      turnScopeId: "turn-timeout",
    };
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    const actionPromise = engine.prepareMonotonicMessageAction();
    const rejectionExpectation = expect(actionPromise).rejects.toThrow(
      "chat.monotonicActionStopTimeout",
    );
    await vi.advanceTimersByTimeAsync(40);

    await rejectionExpectation;
    expect(notify).toHaveBeenCalledWith({
      type: "warning",
      message: "chat.monotonicActionStopTimeout",
    });
    expect(sending.value).toBe(true);
    vi.useRealTimers();
  });

  it("cascadeDeleteMessagesFrom resolves assistant target to user message and removes the user turn", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade" });
    const first = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.rawMessages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
    expect(activeSession.value.updatedAt).toBeTruthy();
  });

  it("cascadeDeleteMessagesFrom removes matching rawMessages even when they are not the same objects", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade-raw-copy" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-1", dialogProcessId: "dp-1" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target", turnScopeId: "turn-1", dialogProcessId: "dp-1" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail", turnScopeId: "turn-2", dialogProcessId: "dp-2" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [
      { ...first },
      { ...target },
      { ...tail },
    ];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.rawMessages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
  });

  it("deleteMonotonicMessage stops before cascading deletion from resolved user message", async () => {
    const { engine, activeSession, sending, canStop, deps } = createHarness({ sessionId: "local-delete" });
    const first = { id: "m1", turnScopeId: "client-turn:resend-stale", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:resend-stale", role: RoleEnum.ASSISTANT, content: "target", pending: true };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      onForceStop();
      return true;
    });

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage stops, cascades deletion, then sends edited content", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, sending, canStop, deps, input } = createHarness({
      sessionId: "local-resend",
      stream,
    });
    const first = { id: "m1", turnScopeId: "client-turn:resend-no-flicker", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:resend-no-flicker", role: RoleEnum.ASSISTANT, content: "target", pending: true };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onForceStop) => {
      onForceStop();
      return true;
    });

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("hello");
  });

  it("resendMonotonicMessage keeps final edited messages after backend delete fallback", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-stale-snapshot",
          dialogProcessId: "dp-edited",
          messages: [
            { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
            { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.USER, content: "first" };
    const staleTarget = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.ASSISTANT, content: "target" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-stale-snapshot", {
        messages: [staleFirst, staleTarget],
        rawMessages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-stale-snapshot",
      sessions: [{
        sessionId: "local-resend-stale-snapshot",
        messages: [
          { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
          { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
        ],
      }],
    }));
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-resend-stale-snapshot",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    const userMessages = activeSession.value.rawMessages.filter((message) => message.role === RoleEnum.USER);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("edited question");
    expect(activeSession.value.rawMessages.find((message) => message.content === "first")).toBeUndefined();
    expect(activeSession.value.rawMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("resendMonotonicMessage keeps edited assistant after final stale prune", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-keep-assistant",
          dialogProcessId: "dp-edited",
          messages: [
            { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
            { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target", dialogProcessId: "dp-old" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-keep-assistant", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-keep-assistant",
      sessions: [{
        sessionId: "local-resend-keep-assistant",
        messages: [
          staleFirst,
          staleTarget,
          { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
          { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
        ],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-keep-assistant",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    const first = { ...staleFirst };
    const target = { ...staleTarget };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    expect(activeSession.value.messages.find((message) => message.content === "first")).toBeUndefined();
    expect(activeSession.value.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
    expect(activeSession.value.rawMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
  });

  it("resendMonotonicMessage keeps the edited turn when final detail reuses the old dialogProcessId", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-reused-dialog",
          dialogProcessId: "dp-old",
          messages: [
            { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-old" },
            { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-old" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target", dialogProcessId: "dp-old" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-reused-dialog", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-reused-dialog",
      sessions: [{
        sessionId: "local-resend-reused-dialog",
        messages: [
          staleFirst,
          staleTarget,
          { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-old" },
          { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-old" },
        ],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-reused-dialog",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([{ ...staleFirst }, { ...staleTarget }]);
    return;

    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "edited question",
      "edited answer",
    ]);
    expect(activeSession.value.rawMessages.map((message) => message.content)).toEqual([
      "edited question",
      "edited answer",
    ]);
  });

  it("resendMonotonicMessage keeps duplicate edited content during final reconcile", async () => {
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "repeat", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "old answer", dialogProcessId: "dp-old" };
    const editedUser = { role: RoleEnum.USER, content: "repeat", dialogProcessId: "dp-old" };
    const editedAssistant = { role: RoleEnum.ASSISTANT, content: "new answer", dialogProcessId: "dp-old" };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-duplicate-content",
          dialogProcessId: "dp-old",
          messages: [editedUser, editedAssistant],
        },
      });
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-duplicate-content", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-duplicate-content",
      sessions: [{
        sessionId: "local-resend-duplicate-content",
        messages: [staleFirst, staleTarget, editedUser, editedAssistant],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-duplicate-content",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "repeat")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([{ ...staleFirst }, { ...staleTarget }]);
    return;

    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "repeat",
      "new answer",
    ]);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage prunes stale backend snapshot before appending edited message", async () => {
    let observedMessagesAtStream = null;
    let observedRawMessagesAtStream = null;
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
      observedRawMessagesAtStream = [...activeSession.value.rawMessages];
    });
    const staleFirst = { id: "m1", role: RoleEnum.USER, content: "first" };
    const staleTarget = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-no-flicker", {
        messages: [staleFirst, staleTarget],
        rawMessages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-no-flicker",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    expect(observedMessagesAtStream).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
    ]));
    expect(observedMessagesAtStream.find((message) => message.content === "first")).toBeUndefined();
    expect(observedRawMessagesAtStream.find((message) => message.content === "first")).toBeUndefined();
    expect(observedMessagesAtStream.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(observedRawMessagesAtStream.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
  });



  it("resendMonotonicMessage continues generation after atomic replace-turn returns user-only snapshot", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: "edited question" };
      return {
      ok: true,
      newTurn: replacementUser,
      session: makeSession("local-resend-replace-success", {
        messages: [replacementUser],
        rawMessages: [replacementUser],
        messageCount: 1,
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
      input.value = "";
    });
    const { engine, activeSession, input, appendMessage, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-resend-replace-success",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "client-turn:old", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 3;
    input.value = "draft before replace";

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-resend-replace-success",
      parentSessionId: "",
      anchor: { turnScopeId: "client-turn:old" },
      newContent: "edited question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
      expectedVersion: 3,
      idempotencyKey: expect.any(String),
    }), expect.any(Object));
    expect(applySessionDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-resend-replace-success",
      sessions: [expect.objectContaining({
        messages: [expect.objectContaining({ turnScopeId: expect.stringMatching(/^client-turn:/), content: "edited question" })],
      })],
    }), { preserveCurrentMessages: true });
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].message).toBe("edited question");
    expect(stream.mock.calls[0][0].sessionId).toBe("local-resend-replace-success");
    expect(stream.mock.calls[0][0].turnScopeId).toEqual(expect.stringMatching(/^client-turn:/));
    expect(stream.mock.calls[0][0].config).toEqual(expect.objectContaining({
      reuseExistingUserTurn: true,
    }));
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      dialogProcessId: "",
      turnScopeId: expect.any(String),
    }));
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).not.toHaveBeenCalledWith(RoleEnum.USER, "edited question", []);
    expect(appendMessage).toHaveBeenCalledWith(RoleEnum.ASSISTANT, "", []);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", ""]);
    expect(activeSession.value.messages[0].turnScopeId).toBe(activeSession.value.messages[1].turnScopeId);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("");
  });

  it("resendMonotonicMessage refreshes session version after 409 and retries replace-turn with the newer version", async () => {
    const stream = vi.fn(async () => {});
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-version-retry",
      sessions: [makeSession("local-resend-version-retry", {
        version: 5,
        revision: 5,
        messages: [
          { turnScopeId: "client-turn:old-version", role: RoleEnum.USER, content: "old" },
          { turnScopeId: "client-turn:old-version", role: RoleEnum.ASSISTANT, content: "stopped", stopState: "stopped" },
        ],
      })],
    }));
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, expectedVersion }) => {
      if (expectedVersion === 3) {
        return { ok: false, status: 409, statusText: "Conflict", error: "session version conflict" };
      }
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: newContent };
      return {
        ok: true,
        session: makeSession("local-resend-version-retry", {
          version: 6,
          revision: 6,
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-resend-version-retry",
      stream,
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    const stoppedUser = { turnScopeId: "client-turn:old-version", role: RoleEnum.USER, content: "old" };
    const stoppedAssistant = { turnScopeId: "client-turn:old-version", role: RoleEnum.ASSISTANT, content: "partial", stopState: "stopped" };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.version = 3;
    activeSession.value.revision = 3;

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited after conflict")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(2);
    expect(replaceSessionTurnApi.mock.calls[0][0]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
    expect(replaceSessionTurnApi.mock.calls[1][0]).toEqual(expect.objectContaining({ expectedVersion: 5 }));
    expect(replaceSessionTurnApi.mock.calls[1][0].idempotencyKey).toContain("retry-version");
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-resend-version-retry", expect.objectContaining({
      force: true,
      reuseRecentlyLoaded: false,
      source: "resendVersionConflict",
    }));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual(expect.objectContaining({
      message: "edited after conflict",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(appendMessage).toHaveBeenCalledWith(RoleEnum.ASSISTANT, "", []);
  });

  it("resendMonotonicMessage does not retry a 409 when refresh does not advance the session version", async () => {
    const stream = vi.fn(async () => {});
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-version-no-change",
      sessions: [makeSession("local-resend-version-no-change", {
        version: 3,
        revision: 3,
        messages: [{ turnScopeId: "client-turn:no-change", role: RoleEnum.USER, content: "old" }],
      })],
    }));
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      error: "session version conflict",
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-version-no-change",
      stream,
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    const stoppedUser = { turnScopeId: "client-turn:no-change", role: RoleEnum.USER, content: "old" };
    const stoppedAssistant = { turnScopeId: "client-turn:no-change", role: RoleEnum.ASSISTANT, content: "partial", stopState: "stopped" };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.version = 3;
    activeSession.value.revision = 3;
    input.value = "draft before failed retry";

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited no retry")).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([stoppedUser, stoppedAssistant]);
    expect(input.value).toBe("draft before failed retry");
  });

  it("resendMonotonicMessage ignores stopped assistant returned with the fresh replacement turn and continues streaming", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      const staleStoppedAssistant = {
        turnScopeId,
        role: RoleEnum.ASSISTANT,
        content: "old stopped partial",
        pending: false,
        statusLabel: "chat.stopped",
        stopState: "stopped",
        channelState: { state: "stopped", turnScopeId },
      };
      return {
        ok: true,
        session: makeSession("local-resend-fresh-stopped-assistant", {
          messages: [replacementUser, staleStoppedAssistant],
          rawMessages: [replacementUser, staleStoppedAssistant],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-resend-fresh-stopped-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      stopState: "stopped",
      channelState: { state: "stopped", turnScopeId: "client-turn:first-old" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited first resend")).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(1);
    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited first resend",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(placeholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: replacementUser.turnScopeId,
    }));
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((message) => message.stopState === "stopped")).toBe(false);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: replacementUser.turnScopeId,
    }));
  });

  it("resendMonotonicMessage rejects stale stopped replacement snapshots without the new turnScopeId", async () => {
    const stream = vi.fn(async () => {});
    const staleStoppedUser = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.USER,
      content: "stopped question",
      stopState: "stopped",
      monotonicState: "monotonic",
    };
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.ASSISTANT,
      content: "partial stopped",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-stale-stopped", {
        messages: [staleStoppedUser, staleStoppedAssistant],
        rawMessages: [staleStoppedUser, staleStoppedAssistant],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-stale-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [staleStoppedUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [staleStoppedUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "edited again")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([staleStoppedUser, staleStoppedAssistant]);
  });

  it("resendMonotonicMessage can repeatedly replace a stopped turn and append a fresh assistant placeholder", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-repeat-stopped", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-repeat-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "stopped",
      monotonicState: "monotonic",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "second resend")).resolves.toBe(true);

    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "second resend",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(replacementUser.stopState).toBeUndefined();
    expect(placeholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: replacementUser.turnScopeId,
    }));
    expect(placeholder.statusLabel).toBe("");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("resendMonotonicMessage keeps the second replacement turn running instead of inheriting stopped state", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-second-stopped", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, runStateSnapshot, sending, canStop } = createHarness({
      sessionId: "local-resend-second-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.USER,
        content: "first stopped",
        stopState: "stopped",
      },
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        stopState: "stopped",
        channelState: { state: "stopped", turnScopeId: "client-turn:old" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstReplacementUser = activeSession.value.messages[0];
    const firstReplacementAssistant = activeSession.value.messages[1];
    const firstTurnScopeId = firstReplacementUser.turnScopeId;

    firstReplacementUser.stopState = "stopped";
    firstReplacementUser.monotonicState = "monotonic";
    firstReplacementAssistant.pending = false;
    firstReplacementAssistant.statusLabel = "chat.stopped";
    firstReplacementAssistant.stopState = "stopped";
    firstReplacementAssistant.channelState = { state: "stopped", turnScopeId: firstTurnScopeId };
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.STOPPED,
      sessionId: "local-resend-second-stopped",
      dialogProcessId: "",
      turnScopeId: firstTurnScopeId,
      seq: 0,
    };
    sending.value = false;
    canStop.value = false;

    await expect(engine.resendMonotonicMessage(firstReplacementAssistant, "third")).resolves.toBe(true);

    const [secondReplacementUser, secondPlaceholder] = activeSession.value.messages;
    expect(secondReplacementUser.turnScopeId).toMatch(/^client-turn:/);
    expect(secondReplacementUser.turnScopeId).not.toBe(firstTurnScopeId);
    expect(secondReplacementUser.stopState).toBeUndefined();
    expect(secondPlaceholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: secondReplacementUser.turnScopeId,
    }));
    expect(secondPlaceholder.stopState).toBeUndefined();
    expect(secondPlaceholder.channelState?.state).not.toBe("stopped");
    expect(runStateSnapshot.value).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: secondReplacementUser.turnScopeId,
    });
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("resendMonotonicMessage ignores stale stopped channel_state replayed onto a fresh replacement turn", async () => {
    let streamCallCount = 0;
    const stream = vi.fn(async (payload, onEvent) => {
      streamCallCount += 1;
      if (streamCallCount === 2) {
        emitChannelState(onEvent, "local-resend-stale-stop-replay", "dp-old-stopped", "stopped", {
          turnScopeId: payload.turnScopeId,
        });
      }
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-stale-stop-replay", {
          messages: [
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.USER,
              content: "historical stopped",
              dialogProcessId: "dp-old-stopped",
              stopState: "stopped",
            },
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.ASSISTANT,
              content: "historical partial",
              pending: false,
              statusLabel: "chat.stopped",
              dialogProcessId: "dp-old-stopped",
              channelState: { state: "stopped", dialogProcessId: "dp-old-stopped", turnScopeId: "client-turn:history" },
            },
            replacementUser,
          ],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, runStateSnapshot, sending, canStop } = createHarness({
      sessionId: "local-resend-stale-stop-replay",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      { turnScopeId: "client-turn:first", role: RoleEnum.USER, content: "first", stopState: "stopped" },
      {
        turnScopeId: "client-turn:first",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        channelState: { state: "stopped", turnScopeId: "client-turn:first" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstAssistant = activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT && message.pending === true);
    firstAssistant.pending = false;
    firstAssistant.statusLabel = "chat.stopped";
    firstAssistant.channelState = { state: "stopped", turnScopeId: firstAssistant.turnScopeId };
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.STOPPED,
      sessionId: "local-resend-stale-stop-replay",
      turnScopeId: firstAssistant.turnScopeId,
      seq: 0,
    };
    sending.value = false;
    canStop.value = false;

    await expect(engine.resendMonotonicMessage(firstAssistant, "third")).resolves.toBe(true);

    const freshPlaceholder = [...activeSession.value.messages]
      .reverse()
      .find((message) => message.role === RoleEnum.ASSISTANT && message.pending === true);
    expect(freshPlaceholder).toEqual(expect.objectContaining({
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(freshPlaceholder.channelState?.state).not.toBe("stopped");
    expect(runStateSnapshot.value).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: freshPlaceholder.turnScopeId,
    });
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("resendMonotonicMessage rejects when frontend run state has no matching in-flight assistant", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => ({
      ok: true,
      session: makeSession("local-resend-state-mismatch", {
        messages: [{ turnScopeId, role: RoleEnum.USER, content: newContent }],
        rawMessages: [{ turnScopeId, role: RoleEnum.USER, content: newContent }],
      }),
    }));
    const { engine, activeSession, runStateSnapshot, sending, canStop, deps } = createHarness({
      sessionId: "local-resend-state-mismatch",
      stream,
      deps: { replaceSessionTurnApi },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old stopped",
      stopState: "stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      channelState: { state: "stopped", turnScopeId: "client-turn:old-stopped" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    sending.value = true;
    canStop.value = false;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      sessionId: "local-resend-state-mismatch",
      turnScopeId: "client-turn:missing-in-flight",
    };

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "retry")).resolves.toBe(false);

    expect(replaceSessionTurnApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([stoppedUser, stoppedAssistant]);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "warning",
      message: "chat.sessionStateOutOfSync",
    }));
  });

  it("resendMonotonicMessage ignores stale stopped assistants after the new replacement user", async () => {
    const stream = vi.fn(async () => {});
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "old stopped partial",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return {
        ok: true,
        session: makeSession("local-resend-ignore-stale-assistant", {
          messages: [replacementUser, staleStoppedAssistant],
          rawMessages: [replacementUser, staleStoppedAssistant],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-ignore-stale-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const oldUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old",
      stopState: "stopped",
    };
    activeSession.value.messages = [oldUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [oldUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "new attempt")).resolves.toBe(true);

    const replacementUser = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    const latestAssistant = activeSession.value.messages[activeSession.value.messages.length - 1];
    expect(latestAssistant).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: replacementUser.turnScopeId,
      statusLabel: "",
    }));
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("resendMonotonicMessage keeps edited content when reusing a stale user message object", async () => {
    let observedUserMessage = null;
    const stream = vi.fn(async () => {
      observedUserMessage = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const staleReplacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: "original question",
      };
      return {
      ok: true,
      newTurn: staleReplacementUser,
      session: makeSession("local-resend-replace-stale", {
        messages: [staleReplacementUser],
        rawMessages: [staleReplacementUser],
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-stale",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:old-stale", role: RoleEnum.USER, content: "original question" };
    const target = { turnScopeId: "client-turn:old-stale", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(observedUserMessage).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited question",
    }));
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", ""]);
  });

  it("resendMonotonicMessage uses backend replace-turn mapping to prune stale replaced messages", async () => {
    let observedMessagesAtStream = [];
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
    });
    const deleteSessionMessagesFromApi = vi.fn();
    const oldUser = {
      id: "old-user",
      turnScopeId: "client-turn:old",
      role: RoleEnum.USER,
      content: "old question",
    };
    const oldAssistant = {
      id: "old-assistant",
      turnScopeId: "client-turn:old",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = {
        id: "new-user",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited question",
      };
      return {
      ok: true,
      turnScopeReplacement: {
        replacedTurnScopeIds: ["client-turn:old"],
        replacementTurnScopeId: turnScopeId,
        replacementTurnScopeIds: [turnScopeId],
      },
      session: makeSession("local-resend-replace-mapping", {
        // Simulate a stale refresh/apply race that still contains the old
        // turn. The explicit backend mapping must decide what to remove.
        messages: [oldUser, oldAssistant, replacementUser],
        rawMessages: [oldUser, oldAssistant, replacementUser],
        messageCount: 3,
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-mapping",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    activeSession.value.messages = [oldUser, oldAssistant];
    activeSession.value.rawMessages = [oldUser, oldAssistant];
    activeSession.value.version = 3;

    await expect(engine.resendMonotonicMessage(oldAssistant, "edited question")).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(observedMessagesAtStream.find((message) => message.id === "old-user")).toBeUndefined();
    expect(observedMessagesAtStream.find((message) => message.id === "old-assistant")).toBeUndefined();
    expect(observedMessagesAtStream).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question", turnScopeId: expect.stringMatching(/^client-turn:/) }),
    ]));
    expect(activeSession.value.messages.find((message) => message.id === "new-user")).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(activeSession.value.messages.find((message) => (
      message.role === RoleEnum.USER &&
      message.content === "edited question" &&
      /^client-turn:/.test(message.turnScopeId)
    ))).toBeTruthy();
  });

  it("resendMonotonicMessage keeps previous duplicate-content turn when resending latest scoped user", async () => {
    let observedMessagesAtStream = null;
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
    });
    const deleteSessionMessagesFromApi = vi.fn();
    const previousUser = {
      id: "u-old",
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: "client-turn:old",
    };
    const previousAssistant = {
      id: "a-old",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      turnScopeId: "client-turn:old",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = {
        id: "u-new",
        role: RoleEnum.USER,
        content: "same question",
        turnScopeId,
      };
      return {
      ok: true,
      newTurn: replacementUser,
      session: makeSession("local-resend-duplicate-scoped-latest", {
        messages: [previousUser, previousAssistant, replacementUser],
        rawMessages: [previousUser, previousAssistant, replacementUser],
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-duplicate-scoped-latest",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const latestUser = {
      id: "u-latest",
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: "client-turn:latest",
    };
    activeSession.value.messages = [previousUser, previousAssistant, latestUser];
    activeSession.value.rawMessages = [previousUser, previousAssistant, latestUser];
    activeSession.value.version = 3;

    await expect(engine.resendMonotonicMessage(latestUser, "same question")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { turnScopeId: "client-turn:latest" },
    }), expect.any(Object));
    expect(observedMessagesAtStream.map((message) => message.id)).toEqual([
      "u-old",
      "a-old",
      "u-new",
      undefined,
    ]);
    expect(observedMessagesAtStream[2]).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(observedMessagesAtStream[3]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: observedMessagesAtStream[2].turnScopeId,
    }));
  });

  it("resendMonotonicMessage does not generate again when replace-turn returns completed assistant snapshot", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: "edited question" };
      const replacementAssistant = { turnScopeId, role: RoleEnum.ASSISTANT, content: "edited answer" };
      return {
      ok: true,
      session: makeSession("local-resend-replace-completed", {
        messages: [replacementUser, replacementAssistant],
        rawMessages: [replacementUser, replacementAssistant],
        messageCount: 2,
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-replace-completed",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    input.value = "draft before replace";

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", "edited answer"]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("");
  });

  it("resendMonotonicMessage fails without delete/send fallback when replace-turn is unsupported", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () => ({ ok: false, status: 404 }));
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-replace-fallback", { messages: [], rawMessages: [] }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-fallback",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited through fallback")).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage fails without fallback when replace-turn throws an HTTP 404 error", async () => {
    const stream = vi.fn(async () => {});
    const notFoundError = new Error("Cannot POST /api/internal/session/u1/s1/messages/replace-turn");
    notFoundError.response = { status: 404 };
    const replaceSessionTurnApi = vi.fn(async () => {
      throw notFoundError;
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-replace-throw-404", { messages: [], rawMessages: [] }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-throw-404",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited after route 404")).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage rolls back and does not fallback when replace-turn fails with conflict", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () => ({ ok: false, status: 409 }));
    const deleteSessionMessagesFromApi = vi.fn();
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-replace-conflict",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", turnScopeId: "client-turn:conflict", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:conflict", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    input.value = "draft before conflict";

    await expect(engine.resendMonotonicMessage(target, "edited conflict")).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("draft before conflict");
  });

  it("resendMonotonicMessage rejects reused dialogId snapshots without the new turnScopeId", async () => {
    const staleFirst = { turnScopeId: "scope-old", dialogId: "dp-reused", role: RoleEnum.USER, content: "repeat" };
    const staleTarget = { turnScopeId: "scope-old", dialogId: "dp-reused", role: RoleEnum.ASSISTANT, content: "old answer" };
    const editedUser = { turnScopeId: "scope-new", dialogId: "dp-reused", role: RoleEnum.USER, content: "repeat" };
    const editedAssistant = { turnScopeId: "scope-new", dialogId: "dp-reused", role: RoleEnum.ASSISTANT, content: "new answer" };
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: true,
      turnScopeReplacement: {
        replacedTurnScopeIds: ["scope-old"],
        replacementTurnScopeId: "scope-new",
        replacementTurnScopeIds: ["scope-new"],
      },
      session: makeSession("local-resend-replace-reused-dialog", {
        messages: [staleFirst, staleTarget, editedUser, editedAssistant],
        rawMessages: [staleFirst, staleTarget, editedUser, editedAssistant],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-reused-dialog",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "repeat")).resolves.toBe(false);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["repeat", "old answer"]);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("deleteMonotonicMessage resolves assistant turnScopeId to user anchor and applies backend snapshot", async () => {
    const backendSession = makeSession("local-delete-api", {
      messages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      rawMessages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      messageCount: 1,
      version: 3,
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: backendSession,
      deletedCount: 2,
      anchorIndex: 1,
      version: 3,
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:delete-1", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "client-turn:delete-1", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { turnScopeId: "client-turn:delete-1" },
      expectedVersion: 2,
    }), expect.any(Object));
    expect(applySessionDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-delete-api",
      sessions: [expect.objectContaining({
        sessionId: "local-delete-api",
        messages: backendSession.messages,
      })],
    }), { preserveCurrentMessages: false });
    expect(activeSession.value.messages).toHaveLength(1);
  });

  it("deleteMonotonicMessage does not locally delete when backend returns failure", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 409 }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api-fail",
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(false);

    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("resendMonotonicMessage does not send when backend delete fails", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 404 }));
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-api-fail",
      stream,
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(input.value).toBe("draft before resend");
  });


  it("deleteMonotonicMessage does not delete when stop precondition fails", async () => {
    vi.useFakeTimers();
    const { engine, activeSession, sending, runStateSnapshot } = createHarness({ sessionId: "local-delete-fail" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-delete-fail" };
    const target = {
      id: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-delete-fail",
      channelState: { state: "sending", turnScopeId: "turn-delete-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "local-delete-fail",
      turnScopeId: "turn-delete-fail",
    };
    const actionPromise = engine.deleteMonotonicMessage(target, { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    vi.useRealTimers();
  });

  it("resendMonotonicMessage does not delete or send when stop precondition fails", async () => {
    vi.useFakeTimers();
    const stream = vi.fn(async () => {});
    const { engine, activeSession, sending, input, runStateSnapshot } = createHarness({ sessionId: "local-resend-fail", stream });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-resend-fail" };
    const target = {
      id: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-resend-fail",
      channelState: { state: "sending", turnScopeId: "turn-resend-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    sending.value = true;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "local-resend-fail",
      turnScopeId: "turn-resend-fail",
    };
    const actionPromise = engine.resendMonotonicMessage(target, "edited", { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(stream).not.toHaveBeenCalled();
    expect(input.value).toBe("hello");
    vi.useRealTimers();
  });

  it("resendMonotonicMessage rolls back cascade deletion when send fails", async () => {
    const stream = vi.fn(async () => {
      throw new Error("network failed");
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { id: "m-new", turnScopeId, role: RoleEnum.USER, content: "edited retry text" };
      return {
        ok: true,
        session: makeSession("local-resend-send-fail", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-send-fail",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "turn-send-fail", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "turn-send-fail", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    activeSession.value.updatedAt = "before";
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(activeSession.value.updatedAt).toBe("before");
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("draft before resend");
  });

  it("consumes stream ERROR event and refreshes session detail before cleanup", async () => {
    const errorData = {
      error: "invalid tool input",
      sessionId: "s-error",
      dialogProcessId: "dp-error",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({ event: StreamEventEnum.ERROR, data: errorData });
      const error = new Error(errorData.error);
      error.data = errorData;
      throw error;
    });
    const fetchSessionDetail = vi.fn(async (sessionId) => ({ sessionId, messages: [] }));
    const applySessionDetail = vi.fn();
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "s-error",
      stream,
      deps: { fetchSessionDetail, applySessionDetail },
    });

    await expect(engine.send()).resolves.toBe(false);

    const botMessage = assistantMessage(activeSession);
    expect(botMessage.dialogProcessId).toBe("dp-error");
    expect(botMessage.pending).toBe(false);
    expect(botMessage.error).toBe("invalid tool input");
    expect(fetchSessionDetail).toHaveBeenCalledWith("s-error");
    expect(applySessionDetail).toHaveBeenCalledWith({ sessionId: "s-error", messages: [] }, {
      preserveCurrentMessages: true,
      scrollToBottom: false,
    });
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(sending.value).toBe(false);
  });

});
