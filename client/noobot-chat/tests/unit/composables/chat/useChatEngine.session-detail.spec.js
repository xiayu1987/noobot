/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
} from "./helpers/useChatEngineHarness";
import { createSessionDetailApplicator } from "../../../../src/composables/chat/chatList/sessionDetailApply";
import { SESSION_DETAIL_APPLY_MODE } from "../../../../src/composables/chat/chatEngine/messageStateGuards";
import {
  RoleEnum,
} from "../../../../src/shared/constants/chatConstants";

function createApplySessionDetailHarness({ sessionId = "s-apply-mode", messages = [] } = {}) {
  const activeSession = {
    id: sessionId,
    sessionId,
    backendSessionId: sessionId,
    title: "current",
    messages,
    rawMessages: [],
  };
  const activeSessionId = ref(sessionId);
  const sessions = ref([activeSession]);
  const { applySessionDetail } = createSessionDetailApplicator({
    sessions,
    activeSessionId,
    makeViewMessage: (message) => ({ ...message }),
    foldMessagesForView: (sourceMessages) => sourceMessages.map((message) => ({ ...message })),
    sessionTitleFromMessages: () => "title",
    applyCompletedToolLogsToMessages: vi.fn(),
    scrollBottom: vi.fn(),
    isSameSessionIdentity: (a, b) => String(a) === String(b),
  });
  return { activeSession, applySessionDetail };
}

describe("useChatEngine.session-detail", () => {
  it("keeps a locally completed turn timing when an early detail omits its finish", () => {
    const turnScopeId = "client-turn:timing-race";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-timing-race",
      messages: [{ role: RoleEnum.ASSISTANT, turnScopeId, dialogProcessId: "dp-timing-race" }],
    });
    activeSession.turnTimingsByTurnScopeId = {
      [turnScopeId]: {
        thinkingStartedAt: "2026-07-15T10:00:00.000Z",
        thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
      },
    };

    applySessionDetail({
      sessionId: "s-timing-race",
      sessions: [{
        sessionId: "s-timing-race",
        messages: [{ role: RoleEnum.ASSISTANT, turnScopeId, dialogProcessId: "dp-timing-race" }],
        turnTimings: [{
          turnScopeId,
          dialogProcessId: "dp-timing-race",
          thinkingStartedAt: "2026-07-15T10:00:00.000Z",
        }],
      }],
    });

    expect(activeSession.turnTimingsByTurnScopeId[turnScopeId]).toEqual({
      thinkingStartedAt: "2026-07-15T10:00:00.000Z",
      thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
    });
  });

  it("keys a persisted timing without turnScopeId through its matching message", () => {
    const turnScopeId = "client-turn:hydrated-timing";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-hydrated-timing",
    });

    applySessionDetail({
      sessionId: "s-hydrated-timing",
      sessions: [{
        sessionId: "s-hydrated-timing",
        messages: [{ role: RoleEnum.ASSISTANT, turnScopeId, dialogProcessId: "dp-hydrated-timing" }],
        turnTimings: [{
          dialogProcessId: "dp-hydrated-timing",
          thinkingStartedAt: "2026-07-15T10:00:00.000Z",
          thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
        }],
      }],
    });

    expect(activeSession.turnTimingsByTurnScopeId[turnScopeId]).toEqual({
      thinkingStartedAt: "2026-07-15T10:00:00.000Z",
      thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
    });
  });

  it("applySessionDetail keeps server renamed title instead of deriving it from messages", () => {
    const sessionTitleFromMessages = vi.fn(() => "old message title");
    const activeSession = {
      id: "s-renamed",
      sessionId: "s-renamed",
      backendSessionId: "s-renamed",
      title: "previous title",
      messages: [],
      rawMessages: [],
    };
    const activeSessionId = ref("s-renamed");
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages,
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId: "s-renamed",
      sessions: [{
        sessionId: "s-renamed",
        title: "Renamed from server",
        messages: [{ role: RoleEnum.USER, content: "old message title" }],
      }],
    });

    expect(activeSession.title).toBe("Renamed from server");
    expect(sessionTitleFromMessages).not.toHaveBeenCalled();
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
          },
        ],
      }],
    }, { preserveCurrentMessages: false });

    expect(activeSession.messages).toHaveLength(3);
    expect(activeSession.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited again", turnScopeId: freshTurnScopeId }),
      expect.objectContaining({
        role: RoleEnum.ASSISTANT,
        turnScopeId: freshTurnScopeId,
        pending: true,
      }),
    ]));
    expect(activeSession.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.ASSISTANT, turnScopeId: staleStoppedTurnScopeId }),
    ]));
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

  it("applySessionDetail lets an authoritative stopped turn replace matching in-flight content", () => {
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
        turnStatuses: [{
          status: "user_stopped",
          reason: "user_stop",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-stale-stopped",
        }],
        messages: [
          { role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
          {
            role: RoleEnum.ASSISTANT,
            content: "已停止",
            turnScopeId: freshTurnScopeId,
            dialogProcessId: "dp-stale-stopped",
            pending: false,
            statusLabel: "chat.stopped",
          },
        ],
      }],
    }, { preserveCurrentMessages: true });

    const assistant = activeSession.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stale-stopped",
    );
    expect(assistant).toEqual(expect.objectContaining({
      content: "已停止",
      turnScopeId: freshTurnScopeId,
      dialogProcessId: "dp-stale-stopped",
      pending: false,
      statusLabel: "chat.stopped",
    }));
    expect(assistant.channelState).toBeUndefined();
    expect(activeSession.turnStatuses).toEqual([
      expect.objectContaining({ status: "user_stopped", turnScopeId: freshTurnScopeId }),
    ]);
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

  it.each([
    SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
    SESSION_DETAIL_APPLY_MODE.FINALIZE_RUN,
    SESSION_DETAIL_APPLY_MODE.REPLACE,
  ])("applySessionDetail %s mode applies authoritative empty snapshot over missing in-flight assistant", (mode) => {
    const turnScopeId = `client-turn:${mode}`;
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: `s-apply-${mode}`,
      messages: [
        { role: RoleEnum.USER, content: "question", turnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId,
          dialogProcessId: `dp-${mode}`,
          pending: true,
          channelState: { state: "stopping", turnScopeId },
        },
      ],
    });

    applySessionDetail({
      sessionId: `s-apply-${mode}`,
      sessions: [{
        sessionId: `s-apply-${mode}`,
        messages: [],
      }],
    }, { mode, preserveCurrentMessages: false });

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.messageCount).toBe(0);
    expect(activeSession.lastMessage).toBe(null);
  });

  it("applySessionDetail merge-preserve-inflight mode keeps missing in-flight assistant during background refresh", () => {
    const turnScopeId = "client-turn:background-preserve";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-apply-background-preserve",
      messages: [
        { role: RoleEnum.USER, content: "question", turnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "streaming",
          turnScopeId,
          dialogProcessId: "dp-background-preserve",
          pending: true,
          channelState: { state: "sending", turnScopeId },
        },
      ],
    });

    applySessionDetail({
      sessionId: "s-apply-background-preserve",
      sessions: [{
        sessionId: "s-apply-background-preserve",
        messages: [],
      }],
    }, { mode: SESSION_DETAIL_APPLY_MODE.MERGE_PRESERVE_IN_FLIGHT });

    expect(activeSession.messages).toHaveLength(2);
    expect(activeSession.messages[1]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      turnScopeId,
      pending: true,
    }));
  });
});
