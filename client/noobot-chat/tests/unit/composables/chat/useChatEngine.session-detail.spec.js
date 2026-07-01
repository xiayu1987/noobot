import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
} from "./helpers/useChatEngineHarness";
import { createSessionDetailApplicator } from "../../../../src/composables/chat/chatList/sessionDetailApply";
import {
  RoleEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.session-detail", () => {
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
});
