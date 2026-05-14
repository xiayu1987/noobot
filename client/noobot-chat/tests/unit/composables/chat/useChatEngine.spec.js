import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatEngine } from "../../../../src/composables/chat/useChatEngine";
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

describe("useChatEngine", () => {
  it("DONE patches current assistant turn and promotes session identity", async () => {
    const activeSessionId = ref("local-1");
    const activeSession = ref({
      id: "local-1",
      backendSessionId: "local-1",
      title: "chat.newSession",
      loaded: false,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      connectorPanelState: { selectedConnectors: {} },
      messageCount: 0,
      lastMessage: null,
      updatedAt: "",
    });
    const sending = ref(false);
    const input = ref("hello");
    const uploadFiles = ref([]);
    const pendingInteractionRequest = ref(null);
    const interactionSubmitting = ref(false);

    const appendMessage = (role, content = "", attachmentMetas = []) => {
      const message = {
        role,
        content,
        attachmentMetas,
        pending: false,
        statusLabel: "",
        realtimeLogs: [],
        executionLogTotal: 0,
        tool_calls: [],
      };
      activeSession.value.messages.push(message);
      activeSession.value.rawMessages.push(message);
      activeSession.value.messageCount = activeSession.value.messages.length;
      activeSession.value.lastMessage = message;
      return message;
    };

    const makeViewMessage = (message) => ({ ...message });
    const foldMessagesForView = (messages) => [...messages];

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
              attachmentMetas: [{ name: "f1" }],
              tool_calls: [{ id: "tc1" }],
            },
          ],
        },
      });
    });

    const engine = useChatEngine({
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
      input,
      uploadFiles,
      clearUploads: vi.fn(),
      serializeAttachments: vi.fn(async () => []),
      appendMessage,
      makeViewMessage,
      foldMessagesForView,
      fetchSessionDetail: vi.fn(async () => {
        throw new Error("ignore detail fetch in this unit test");
      }),
      applySessionDetail: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      connectorTypeSet: new Set(),
      upsertConnectedConnectorInPanelState: vi.fn(),
      pendingInteractionRequest,
      interactionSubmitting,
      clearPendingInteraction: vi.fn(),
      setPendingInteractionRequest: vi.fn(),
      submitInteractionResponse: vi.fn(),
      chatWebSocketClient: {
        stream,
        requestStop: vi.fn(),
        clearLastReceivedSeqMap: vi.fn(),
        dispose: vi.fn(),
        clearStopRequested: vi.fn(),
        isStopRequested: vi.fn(() => false),
      },
      ensureConnected: vi.fn(() => true),
      notify: vi.fn(),
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
  });
});
