/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyTurnRuntimeEvent,
  applyTurnTerminalResolution,
  createTurnRuntimeRegistryState,
  applyTurnTimingSnapshot,
  selectTurnMessageRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTurnRuntimeStoreActions } from "../../../../../src/modules/chat/stores/chatStoreTurnRuntime.js";
import {
  AGENT_CHANNEL_STATE,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnTerminalResolution } from "@noobot/session-protocol";
import { terminalStatusFixture } from "../helpers/terminalStatusFixture.js";

function createApplySessionDetailHarness({ sessionId = "s-apply-mode", messages = [] } = {}) {
  const activeSession = {
    id: sessionId,
    sessionId,
    title: "current",
    messages,
    rawMessages: [],
  };
  const sessions = ref([activeSession]);
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnCommitted: vi.fn(() => null),
    onTurnEvaluated: vi.fn(),
  });
  const { applySessionDetail } = createSessionDetailApplicator({
    sessions,
    makeViewMessage: (message) => ({ ...message }),
    sessionTitleFromMessages: () => "title",
    onSessionDetailApplied: vi.fn(),
    turnRuntimeRegistry,
    chatStore,
  });
  return { activeSession, applySessionDetail, turnRuntimeRegistry };
}

function createTurnRuntimeStore() {
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnCommitted: vi.fn(() => null),
    onTurnEvaluated: vi.fn(),
  });
  return { turnRuntimeRegistry, chatStore };
}

describe("useChatEngine.session-detail", () => {
  it("keeps a recorded thinking finish when a later detail carries no timing", () => {
    const turnScopeId = "client-turn:timing-race";
    const { applySessionDetail, turnRuntimeRegistry } = createApplySessionDetailHarness({
      sessionId: "s-timing-race",
      messages: [
        {
          presentationMessageId: "msg-timing-race",
          role: RoleEnum.ASSISTANT,
          turnScopeId,
          dialogProcessId: "dp-timing-race",
        },
      ],
    });
    applyTurnTimingSnapshot(turnRuntimeRegistry.value, {
      sessionId: "s-timing-race",
      turnTimings: [
        {
          turnScopeId,
          dialogProcessId: "dp-timing-race",
          thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
        },
      ],
    });

    applySessionDetail({
      sessionId: "s-timing-race",
      sessions: [
        {
          sessionId: "s-timing-race",
          messages: [
            {
              presentationMessageId: "msg-timing-race",
              role: RoleEnum.ASSISTANT,
              turnScopeId,
              dialogProcessId: "dp-timing-race",
            },
          ],
          turnTimings: [],
        },
      ],
    });

    expect(turnRuntimeRegistry.value.sessions["s-timing-race"].turns[turnScopeId]).toMatchObject({
      timing: { thinkingFinishedAt: "2026-07-15T10:00:05.000Z" },
    });
  });

  it("keys a persisted timing by its canonical turnScopeId", () => {
    const turnScopeId = "client-turn:hydrated-timing";
    const { applySessionDetail, turnRuntimeRegistry } = createApplySessionDetailHarness({
      sessionId: "s-hydrated-timing",
    });

    applySessionDetail({
      sessionId: "s-hydrated-timing",
      sessions: [
        {
          sessionId: "s-hydrated-timing",
          messages: [
            {
              presentationMessageId: "msg-hydrated-timing",
              role: RoleEnum.ASSISTANT,
              turnScopeId,
              dialogProcessId: "dp-hydrated-timing",
            },
          ],
          turnTimings: [
            {
              turnScopeId,
              dialogProcessId: "dp-hydrated-timing",
              thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
            },
          ],
        },
      ],
    });

    expect(
      turnRuntimeRegistry.value.sessions["s-hydrated-timing"].turns[turnScopeId],
    ).toMatchObject({
      timing: {
        turnScopeId,
        dialogProcessId: "dp-hydrated-timing",
        thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
      },
    });
  });

  it("applySessionDetail keeps server renamed title instead of deriving it from messages", () => {
    const sessionTitleFromMessages = vi.fn(() => "old message title");
    const activeSession = {
      id: "s-renamed",
      sessionId: "s-renamed",
      title: "previous title",
      messages: [],
      rawMessages: [],
    };
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      ...createTurnRuntimeStore(),
      makeViewMessage: (message) => ({ ...message }),
      sessionTitleFromMessages,
      onSessionDetailApplied: vi.fn(),
    });

    applySessionDetail({
      sessionId: "s-renamed",
      sessions: [
        {
          sessionId: "s-renamed",
          turnTimings: [],
          title: "Renamed from server",
          messages: [
            {
              messageUid: "sm-user-renamed",
              userMessageId: "um-user-renamed",
              role: RoleEnum.USER,
              content: "old message title",
            },
          ],
        },
      ],
    });

    expect(activeSession.title).toBe("Renamed from server");
    expect(sessionTitleFromMessages).not.toHaveBeenCalled();
  });

  it("applySessionDetail does not roll back a newer local session version", () => {
    const activeSession = {
      sessionId: "s-apply-version",
      title: "current",
      aggregateVersion: 9,
      messages: [
        {
          messageUid: "sm-user-version",
          role: RoleEnum.USER,
          content: "current",
          turnScopeId: "client-turn:version",
        },
      ],
      rawMessages: [],
    };
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      ...createTurnRuntimeStore(),
      makeViewMessage: (message) => ({ ...message }),
      sessionTitleFromMessages: () => "title",
      onSessionDetailApplied: vi.fn(),
    });

    applySessionDetail({
      sessionId: "s-apply-version",
      sessions: [
        {
          sessionId: "s-apply-version",
          turnTimings: [],
          aggregateVersion: 7,
          messages: [
            {
              messageUid: "sm-user-version",
              role: RoleEnum.USER,
              content: "stale",
              turnScopeId: "client-turn:version",
            },
          ],
        },
      ],
    });

    expect(activeSession.aggregateVersion).toBe(9);

    applySessionDetail({
      sessionId: "s-apply-version",
      sessions: [
        {
          sessionId: "s-apply-version",
          turnTimings: [],
          aggregateVersion: 10,
          messages: [
            {
              messageUid: "sm-user-version",
              role: RoleEnum.USER,
              content: "fresh",
              turnScopeId: "client-turn:version",
            },
          ],
        },
      ],
    });

    expect(activeSession.aggregateVersion).toBe(10);
  });

  it("applySessionDetail lets an authoritative stopped turn replace matching in-flight content", () => {
    const freshTurnScopeId = "client-turn:fresh-same-scope";
    const activeSession = {
      id: "s-apply-same-scope-stopped",
      sessionId: "s-apply-same-scope-stopped",
      title: "current",
      messages: [
        {
          messageUid: "msg-user-same-scope-stopped",
          userMessageId: "msg-user-same-scope-stopped",
          role: RoleEnum.USER,
          content: "edited question",
          turnScopeId: freshTurnScopeId,
        },
        {
          presentationMessageId: "msg-assistant-same-scope-stopped",
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-local-pending",
          pending: true,
          terminalOutcome: "",
          channelState: { state: "sending", turnScopeId: freshTurnScopeId },
        },
      ],
    };
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
      state: AGENT_CHANNEL_STATE.SENDING,
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
      state: AGENT_CHANNEL_STATE.USER_STOPPED,
      seq: 4,
    });
    const terminalResult = applyTurnTerminalResolution(
      registry,
      createTurnTerminalResolution({
        commandId: "terminal-resolution-stopped-detail",
        sessionId: activeSession.sessionId,
        turnScopeId: freshTurnScopeId,
        resolved: true,
        aggregateVersion: 1,
        turn: {
          continuedByTurnScopeId: "",
          sessionId: activeSession.sessionId,
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-stale-stopped",
          state: "stop_completed",
          phase: "stop",
          revision: 5,
          sequence: 5,
          completionCommitId: "commit-stopped-detail",
          summaryVersion: 5,
          terminalStatus: terminalStatusFixture("stop_completed", {
            turnScopeId: freshTurnScopeId,
            dialogProcessId: "dp-stale-stopped",
          }),
        },
      }),
    );
    expect(terminalResult.applied).toBe(true);
    const turnRuntimeRegistry = ref(registry);
    expect(
      selectTurnMessageRuntime(registry, {
        sessionId: activeSession.sessionId,
        turnScopeId: freshTurnScopeId,
      }),
    ).toMatchObject({ running: false, terminal: "user_stopped" });
    const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
      onTurnCommitted: vi.fn(() => null),
      onTurnEvaluated: vi.fn(),
    });
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      turnRuntimeRegistry,
      chatStore,
      makeViewMessage: (message) => ({ ...message }),
      sessionTitleFromMessages: () => "title",
      onSessionDetailApplied: vi.fn(),
    });

    applySessionDetail({
      sessionId: "s-apply-same-scope-stopped",
      sessions: [
        {
          sessionId: "s-apply-same-scope-stopped",
          turnTimings: [],
          messages: [
            {
              messageUid: "msg-user-same-scope-stopped",
              userMessageId: "msg-user-same-scope-stopped",
              role: RoleEnum.USER,
              content: "edited question",
              turnScopeId: freshTurnScopeId,
            },
            {
              presentationMessageId: "msg-assistant-same-scope-stopped",
              role: RoleEnum.ASSISTANT,
              content: "已停止",
              turnScopeId: freshTurnScopeId,
              dialogProcessId: "dp-stale-stopped",
              pending: false,
              terminalOutcome: "stopped",
            },
          ],
        },
      ],
    });

    const assistant = activeSession.messages.find(
      (message) =>
        message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stale-stopped",
    );
    expect(assistant).toEqual(
      expect.objectContaining({
        turnScopeId: freshTurnScopeId,
        dialogProcessId: "dp-stale-stopped",
        pending: false,
        terminalOutcome: "stopped",
      }),
    );
    expect(assistant.content).toContain("已停止");
    expect(assistant.channelState).toBeUndefined();
  });

  it("applySessionDetail still merges completed detail into an in-flight assistant with the same turnScopeId", () => {
    const freshTurnScopeId = "client-turn:fresh-completed-scope";
    const activeSession = {
      id: "s-apply-same-scope-completed",
      sessionId: "s-apply-same-scope-completed",
      title: "current",
      messages: [
        {
          messageUid: "msg-user-same-scope-completed",
          userMessageId: "msg-user-same-scope-completed",
          role: RoleEnum.USER,
          content: "edited question",
          turnScopeId: freshTurnScopeId,
        },
        {
          presentationMessageId: "msg-assistant-same-scope-completed",
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId: freshTurnScopeId,
          dialogProcessId: "dp-local-pending",
          pending: true,
          terminalOutcome: "",
          channelState: { state: "sending", turnScopeId: freshTurnScopeId },
        },
      ],
    };
    const sessions = ref([activeSession]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      ...createTurnRuntimeStore(),
      makeViewMessage: (message) => ({ ...message }),
      sessionTitleFromMessages: () => "title",
      onSessionDetailApplied: vi.fn(),
    });

    applySessionDetail({
      sessionId: "s-apply-same-scope-completed",
      sessions: [
        {
          sessionId: "s-apply-same-scope-completed",
          turnTimings: [],
          messages: [
            {
              messageUid: "msg-user-same-scope-completed",
              userMessageId: "msg-user-same-scope-completed",
              role: RoleEnum.USER,
              content: "edited question",
              turnScopeId: freshTurnScopeId,
            },
            {
              presentationMessageId: "msg-assistant-same-scope-completed",
              role: RoleEnum.ASSISTANT,
              content: "answer done",
              turnScopeId: freshTurnScopeId,
              dialogProcessId: "dp-completed",
              pending: false,
              completed: true,
              channelState: { state: "completed", turnScopeId: freshTurnScopeId },
            },
          ],
        },
      ],
    });

    const assistant = activeSession.messages.find((message) => message.role === RoleEnum.ASSISTANT);
    expect(assistant).toEqual(
      expect.objectContaining({
        content: "answer done",
        turnScopeId: freshTurnScopeId,
        dialogProcessId: "dp-completed",
        pending: false,
        completed: true,
      }),
    );
  });

  it("applySessionDetail applies authoritative empty snapshot over missing in-flight assistant", () => {
    const turnScopeId = "client-turn:empty-snapshot";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-apply-empty-snapshot",
      messages: [
        { role: RoleEnum.USER, content: "question", turnScopeId },
        {
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId,
          dialogProcessId: "dp-empty-snapshot",
          pending: true,
          channelState: { state: "stopping", turnScopeId },
        },
      ],
    });

    applySessionDetail({
      sessionId: "s-apply-empty-snapshot",
      sessions: [
        {
          sessionId: "s-apply-empty-snapshot",
          turnTimings: [],
          messages: [],
        },
      ],
    });

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.messageCount).toBe(0);
    expect(activeSession.lastMessage).toBe(null);
  });

  it("keeps the canonical active assistant when full detail follows summary hydration", () => {
    const sessionId = "s-refresh-after-second-resend";
    const turnScopeId = "client-turn:second-resend-active";
    const presentationMessageId = "msg_second_resend_active";
    const canonicalMessages = [
      {
        messageUid: "user_second_resend_active",
        userMessageId: "user_second_resend_active",
        role: RoleEnum.USER,
        content: "question",
        turnScopeId,
      },
      {
        presentationMessageId,
        role: RoleEnum.ASSISTANT,
        content: "",
        turnScopeId,
        dialogProcessId: "dp-second-resend-active",
        chatPresentation: true,
        turnPlaceholder: true,
      },
    ];
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({ sessionId });

    applySessionDetail({
      sessionId,
      summary: true,
      sessions: [{ sessionId, messages: canonicalMessages, turnTimings: [] }],
    });
    applySessionDetail({
      sessionId,
      detailMode: "full",
      sessions: [
        {
          sessionId,
          turnTimings: [],
          messages: canonicalMessages,
          rawMessages: [canonicalMessages[0]],
        },
      ],
    });

    expect(activeSession.messages).toHaveLength(2);
    expect(activeSession.messages[1]).toEqual(
      expect.objectContaining({
        presentationMessageId,
        turnScopeId,
        turnPlaceholder: true,
      }),
    );
    expect(activeSession.sessionDocs[0].rawMessages).toHaveLength(1);
  });

  it("finalize-run replaces second-resend presentation state with the authoritative snapshot", () => {
    const sessionId = "s-second-resend-finalize";
    const turnScopeId = "client-turn:second-resend";
    const presentationMessageId = "msg_second_resend";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId,
      messages: [
        {
          messageUid: "user_second_resend",
          userMessageId: "user_second_resend",
          role: RoleEnum.USER,
          content: "question",
          turnScopeId,
        },
        {
          presentationMessageId: "msg_previous_resend",
          role: RoleEnum.ASSISTANT,
          content: "stale answer",
          turnScopeId: "client-turn:previous-resend",
          pending: false,
        },
        {
          presentationMessageId,
          role: RoleEnum.ASSISTANT,
          content: "",
          turnScopeId,
          dialogProcessId: "dp-second-resend",
          pending: true,
        },
      ],
    });
    activeSession.detailMessages = [
      {
        messageUid: "user_previous_resend",
        userMessageId: "user_previous_resend",
        role: RoleEnum.USER,
        content: "question",
        turnScopeId: "client-turn:previous-resend",
      },
      {
        presentationMessageId: "msg_previous_resend",
        role: RoleEnum.ASSISTANT,
        content: "stale answer",
        turnScopeId: "client-turn:previous-resend",
      },
    ];

    applySessionDetail({
      sessionId,
      sessions: [
        {
          sessionId,
          turnTimings: [],
          messages: [
            {
              messageUid: "user_second_resend",
              userMessageId: "user_second_resend",
              role: RoleEnum.USER,
              content: "question",
              turnScopeId,
            },
            {
              presentationMessageId,
              role: RoleEnum.ASSISTANT,
              content: "authoritative answer",
              turnScopeId,
              dialogProcessId: "dp-second-resend",
              pending: false,
            },
          ],
        },
      ],
    });

    expect(activeSession.messages).toHaveLength(2);
    expect(activeSession.detailMessages).toHaveLength(2);
    expect(activeSession.messages.filter((message) => message.role === RoleEnum.ASSISTANT)).toEqual(
      [
        expect.objectContaining({
          presentationMessageId,
          content: "authoritative answer",
          pending: false,
        }),
      ],
    );
    expect(
      activeSession.messages.some(
        (message) => message.presentationMessageId === "msg_previous_resend",
      ),
    ).toBe(false);
  });

  it("replaces stale pre-resend detail history with an authoritative empty response", () => {
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
    applySessionDetail({
      sessionId: "s-delete-after-second-stop",
      sessions: [
        {
          sessionId: "s-delete-after-second-stop",
          messages: [],
          turnTimings: [],
        },
      ],
    });

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.detailMessages).toEqual([]);
    expect(activeSession).not.toHaveProperty("turnTimings");
  });

  it("rejects an available session doc without a turnTimings array", () => {
    const { applySessionDetail } = createApplySessionDetailHarness({ sessionId: "s-no-timings" });
    expect(() =>
      applySessionDetail({
        sessionId: "s-no-timings",
        sessions: [{ sessionId: "s-no-timings", messages: [] }],
      }),
    ).toThrow(/requires turnTimings array/);
  });

  it("skips turn timings for an unavailable session doc", () => {
    const { activeSession, applySessionDetail, turnRuntimeRegistry } =
      createApplySessionDetailHarness({ sessionId: "s-unavailable" });

    applySessionDetail({
      sessionId: "s-unavailable",
      sessions: [
        {
          sessionId: "s-unavailable",
          availability: "unavailable",
          unavailableReason: { code: "SESSION_PROTOCOL_INVALID", message: "invalid" },
        },
      ],
    });

    expect(activeSession.loaded).toBe(true);
    expect(turnRuntimeRegistry.value.sessions["s-unavailable"]).toBeUndefined();
  });
});
