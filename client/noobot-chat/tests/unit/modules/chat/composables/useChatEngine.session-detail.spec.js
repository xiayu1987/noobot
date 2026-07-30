/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
} from "../helpers/useChatEngineHarness.js";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { SESSION_DETAIL_APPLY_MODE } from "../../../../../src/modules/chat/runtime/engine/messageStateGuards.js";
import {
  RoleEnum,
} from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyTurnRuntimeEvent,
  applyTurnTerminalResolution,
  createTurnRuntimeRegistryState,
  selectTurnMessageRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnTerminalResolution } from "@noobot/authoritative-state/contracts";

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

  it("keys a persisted timing by its canonical turnScopeId", () => {
    const turnScopeId = "client-turn:hydrated-timing";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-hydrated-timing",
    });

    applySessionDetail({
      sessionId: "s-hydrated-timing",
      sessions: [{
        sessionId: "s-hydrated-timing",
        messages: [{ id: "msg-hydrated-timing", messageId: "msg-hydrated-timing", role: RoleEnum.ASSISTANT, turnScopeId, dialogProcessId: "dp-hydrated-timing" }],
        turnTimings: [{
          turnScopeId,
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
        { id: "msg-user-fresh-apply", messageId: "msg-user-fresh-apply", role: RoleEnum.USER, content: "edited again", turnScopeId: freshTurnScopeId },
        {
          id: "msg-assistant-fresh-apply",
          messageId: "msg-assistant-fresh-apply",
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
          { id: "msg-user-old-apply", messageId: "msg-user-old-apply", role: RoleEnum.USER, content: "old stopped", turnScopeId: staleStoppedTurnScopeId },
          {
            id: "msg-assistant-old-apply",
            messageId: "msg-assistant-old-apply",
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
        { id: "msg-user-same-scope-stopped", messageId: "msg-user-same-scope-stopped", role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
        {
          id: "msg-assistant-same-scope-stopped",
          messageId: "msg-assistant-same-scope-stopped",
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
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
      seq: 1,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
      state: BackendChannelState.SENDING,
      seq: 2,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
      seq: 3,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
      state: BackendChannelState.USER_STOPPED,
      seq: 4,
    });
    const terminalResult = applyTurnTerminalResolution(registry, createTurnTerminalResolution({
      commandId: "terminal-resolution-stopped-detail",
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
      resolved: true,
      turn: {
        turnScopeId: freshTurnScopeId,
        dialogProcessId: "dp-stale-stopped",
        state: "stop_completed",
        phase: "stop",
        revision: 5,
        sequence: 5,
        completionCommitId: "commit-stopped-detail",
        summaryVersion: 5,
      },
      materialization: {
        completionCommitId: "commit-stopped-detail",
        summaryVersion: 5,
        revision: 5,
        sequence: 5,
        terminalStatus: { status: "stop_completed" },
        messages: [],
      },
    }));
    expect(terminalResult.applied).toBe(true);
    const turnRuntimeRegistry = ref(registry);
    expect(selectTurnMessageRuntime(registry, {
      sessionId: activeSession.sessionId,
      turnScopeId: freshTurnScopeId,
    })).toMatchObject({ running: false, terminal: "user_stopped" });
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId,
      turnRuntimeRegistry,
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
          { id: "msg-user-same-scope-stopped", messageId: "msg-user-same-scope-stopped", role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
          {
            id: "msg-assistant-same-scope-stopped",
            messageId: "msg-assistant-same-scope-stopped",
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

  it("applySessionDetail does not let a legacy user_stopped status override a still-running registry turn", () => {
    const turnScopeId = "client-turn:fresh-running-scope";
    const sessionId = "s-apply-running-legacy-stop";
    const activeSession = {
      id: sessionId,
      sessionId,
      backendSessionId: sessionId,
      title: "current",
      messages: [{
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId,
        pending: true,
        channelState: { state: "sending", turnScopeId },
      }],
    };
    const sessions = ref([activeSession]);
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId,
      turnScopeId,
      seq: 1,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId,
      turnScopeId,
      state: BackendChannelState.SENDING,
      seq: 2,
    });
    expect(selectTurnMessageRuntime(registry, { sessionId, turnScopeId }))
      .toMatchObject({ running: true, terminal: null });
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      activeSessionId: ref(sessionId),
      turnRuntimeRegistry: ref(registry),
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages.map((message) => ({ ...message })),
      sessionTitleFromMessages: () => "title",
      applyCompletedToolLogsToMessages: vi.fn(),
      scrollBottom: vi.fn(),
      isSameSessionIdentity: (a, b) => String(a) === String(b),
    });

    applySessionDetail({
      sessionId,
      sessions: [{
        sessionId,
        turnStatuses: [{ status: "user_stopped", turnScopeId }],
        messages: [{
          role: RoleEnum.ASSISTANT,
          content: "已停止",
          turnScopeId,
          pending: false,
          statusLabel: "chat.stopped",
        }],
      }],
    }, { preserveCurrentMessages: true });

    const assistant = activeSession.messages.find((message) => message.turnScopeId === turnScopeId);
    expect(assistant.pending).toBe(true);
    expect(assistant.channelState).toEqual({ state: "sending", turnScopeId });
  });

  it("applySessionDetail still merges completed detail into an in-flight assistant with the same turnScopeId", () => {
    const freshTurnScopeId = "client-turn:fresh-completed-scope";
    const activeSession = {
      id: "s-apply-same-scope-completed",
      sessionId: "s-apply-same-scope-completed",
      backendSessionId: "s-apply-same-scope-completed",
      title: "current",
      messages: [
        { id: "msg-user-same-scope-completed", messageId: "msg-user-same-scope-completed", role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
        {
          id: "msg-assistant-same-scope-completed",
          messageId: "msg-assistant-same-scope-completed",
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
          { id: "msg-user-same-scope-completed", messageId: "msg-user-same-scope-completed", role: RoleEnum.USER, content: "edited question", turnScopeId: freshTurnScopeId },
          {
            id: "msg-assistant-same-scope-completed",
            messageId: "msg-assistant-same-scope-completed",
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

  it("delete-confirmed replaces stale pre-resend detail history with an authoritative empty response", () => {
    const previousTurnScopeId = "client-turn:before-resend";
    const deletedTurnScopeId = "client-turn:deleted-resend";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-delete-after-second-stop",
      messages: [
        { role: RoleEnum.USER, content: "same question", turnScopeId: deletedTurnScopeId },
        { role: RoleEnum.ASSISTANT, content: "stopped", turnScopeId: deletedTurnScopeId },
      ],
    });
    activeSession.detailMessages = [
      { role: RoleEnum.USER, content: "same question", turnScopeId: previousTurnScopeId },
      { role: RoleEnum.ASSISTANT, content: "first stopped", turnScopeId: previousTurnScopeId },
    ];
    activeSession.turnStatuses = [{ turnScopeId: previousTurnScopeId, status: "user_stopped" }];
    activeSession.turnTimings = [{ turnScopeId: previousTurnScopeId, thinkingStartedAt: "2026-07-24T13:55:13.000Z" }];

    applySessionDetail({
      sessionId: "s-delete-after-second-stop",
      sessions: [{
        sessionId: "s-delete-after-second-stop",
        messages: [],
        turnStatuses: [],
        turnTimings: [],
      }],
    }, {
      mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
      preserveCurrentMessages: false,
      deleteFromTurnScopeId: deletedTurnScopeId,
    });

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.detailMessages).toEqual([]);
    expect(activeSession.turnStatuses).toEqual([]);
    expect(activeSession.turnTimings).toEqual([]);
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
