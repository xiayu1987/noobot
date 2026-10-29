/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { buildViewMessage } from "../../../../../src/modules/chat/model/messageModel.js";
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
import { SESSION_ERROR_CODE, createTurnTerminalResolution } from "@noobot/session-protocol";
import { terminalStatusFixture } from "../helpers/terminalStatusFixture.js";
import {
  availableDetailDocument,
  availableDetailEntry,
  unavailableDetailDocument,
} from "../../../helpers/sessionDetailFixture.js";

const FIXTURE_USER_ID = "u-1";

function viewMessage(message, sessionId) {
  return buildViewMessage(message, { sessionId, userId: FIXTURE_USER_ID });
}

function createTurnRuntimeStore() {
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
  const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnCommitted: vi.fn(() => null),
    onTurnEvaluated: vi.fn(),
  });
  return { turnRuntimeRegistry, chatStore };
}

function createApplicator({ sessions, turnRuntimeRegistry, chatStore }) {
  return createSessionDetailApplicator({
    sessions,
    turnRuntimeRegistry,
    chatStore,
    makeViewMessage: (message, { sessionId }) => viewMessage(message, sessionId),
    onSessionDetailApplied: vi.fn(),
  });
}

function createApplySessionDetailHarness({ sessionId, messages }) {
  const activeSession = {
    sessionId,
    title: "current",
    aggregateVersion: 0,
    messages: messages.map((message) => viewMessage(message, sessionId)),
  };
  const sessions = ref([activeSession]);
  const { turnRuntimeRegistry, chatStore } = createTurnRuntimeStore();
  const { applySessionDetail } = createApplicator({ sessions, turnRuntimeRegistry, chatStore });
  return { activeSession, applySessionDetail, turnRuntimeRegistry };
}

describe("useChatEngine.session-detail", () => {
  it("keeps a recorded thinking finish when a later detail carries no timing", () => {
    const turnScopeId = "client-turn:timing-race";
    const assistant = {
      presentationMessageId: "msg-timing-race",
      role: RoleEnum.ASSISTANT,
      content: "",
      turnScopeId,
      dialogProcessId: "dp-timing-race",
    };
    const { applySessionDetail, turnRuntimeRegistry } = createApplySessionDetailHarness({
      sessionId: "s-timing-race",
      messages: [{ ...assistant }],
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

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-timing-race",
        title: "fixture title",
        aggregateVersion: 1,
        messages: [{ ...assistant }],
        turnTimings: [],
      }),
    );

    expect(turnRuntimeRegistry.value.sessions["s-timing-race"].turns[turnScopeId]).toMatchObject({
      timing: { thinkingFinishedAt: "2026-07-15T10:00:05.000Z" },
    });
  });

  it("keys a persisted timing by its canonical turnScopeId", () => {
    const turnScopeId = "client-turn:hydrated-timing";
    const { applySessionDetail, turnRuntimeRegistry } = createApplySessionDetailHarness({
      sessionId: "s-hydrated-timing",
      messages: [],
    });

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-hydrated-timing",
        title: "fixture title",
        aggregateVersion: 1,
        messages: [
          {
            presentationMessageId: "msg-hydrated-timing",
            role: RoleEnum.ASSISTANT,
            content: "",
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
      }),
    );

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

  it("applySessionDetail takes the session title from the server entry", () => {
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-renamed",
      messages: [],
    });

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-renamed",
        title: "Renamed from server",
        aggregateVersion: 1,
        messages: [
          {
            messageUid: "sm-user-renamed",
            userMessageId: "um-user-renamed",
            role: RoleEnum.USER,
            content: "old message title",
          },
        ],
        turnTimings: [],
      }),
    );

    expect(activeSession.title).toBe("Renamed from server");
  });

  it("applySessionDetail does not roll back a newer local session version", () => {
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-apply-version",
      messages: [
        {
          messageUid: "sm-user-version",
          role: RoleEnum.USER,
          content: "current",
          turnScopeId: "client-turn:version",
        },
      ],
    });
    activeSession.aggregateVersion = 9;
    const detailAt = (aggregateVersion, content) =>
      availableDetailDocument({
        sessionId: "s-apply-version",
        title: "fixture title",
        aggregateVersion,
        messages: [
          {
            messageUid: "sm-user-version",
            role: RoleEnum.USER,
            content,
            turnScopeId: "client-turn:version",
          },
        ],
        turnTimings: [],
      });

    applySessionDetail(detailAt(7, "stale"));
    expect(activeSession.aggregateVersion).toBe(9);

    applySessionDetail(detailAt(10, "fresh"));
    expect(activeSession.aggregateVersion).toBe(10);
  });

  it("applySessionDetail lets an authoritative stopped turn replace matching in-flight content", () => {
    const freshTurnScopeId = "client-turn:fresh-same-scope";
    const sessionId = "s-apply-same-scope-stopped";
    const activeSession = {
      sessionId,
      title: "current",
      aggregateVersion: 0,
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
      ].map((message) => viewMessage(message, sessionId)),
    };
    const sessions = ref([activeSession]);
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId,
      turnScopeId: freshTurnScopeId,
      seq: 1,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId,
      turnScopeId: freshTurnScopeId,
      state: AGENT_CHANNEL_STATE.SENDING,
      seq: 2,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
      sessionId,
      turnScopeId: freshTurnScopeId,
      seq: 3,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId,
      turnScopeId: freshTurnScopeId,
      state: AGENT_CHANNEL_STATE.USER_STOPPED,
      seq: 4,
    });
    const terminalResult = applyTurnTerminalResolution(
      registry,
      createTurnTerminalResolution({
        commandId: "terminal-resolution-stopped-detail",
        sessionId,
        turnScopeId: freshTurnScopeId,
        resolved: true,
        aggregateVersion: 1,
        turn: {
          continuedByTurnScopeId: "",
          sessionId,
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
      selectTurnMessageRuntime(registry, { sessionId, turnScopeId: freshTurnScopeId }),
    ).toMatchObject({ running: false, terminal: "user_stopped" });
    const chatStore = createTurnRuntimeStoreActions(turnRuntimeRegistry, {
      onTurnCommitted: vi.fn(() => null),
      onTurnEvaluated: vi.fn(),
    });
    const { applySessionDetail } = createApplicator({ sessions, turnRuntimeRegistry, chatStore });

    applySessionDetail(
      availableDetailDocument({
        sessionId,
        title: "fixture title",
        aggregateVersion: 1,
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
        turnTimings: [],
      }),
    );

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

  it("applySessionDetail replaces an in-flight assistant with the completed authoritative turn", () => {
    const freshTurnScopeId = "client-turn:fresh-completed-scope";
    const { activeSession, applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-apply-same-scope-completed",
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
    });

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-apply-same-scope-completed",
        title: "fixture title",
        aggregateVersion: 1,
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
            channelState: { state: "completed", turnScopeId: freshTurnScopeId },
          },
        ],
        turnTimings: [],
      }),
    );

    const assistant = activeSession.messages.find((message) => message.role === RoleEnum.ASSISTANT);
    expect(assistant).toEqual(
      expect.objectContaining({
        content: "answer done",
        turnScopeId: freshTurnScopeId,
        dialogProcessId: "dp-completed",
        pending: false,
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

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-apply-empty-snapshot",
        title: "fixture title",
        aggregateVersion: 1,
        messages: [],
        turnTimings: [],
      }),
    );

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.messageCount).toBe(0);
    expect(activeSession.lastMessage).toBe(null);
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

    applySessionDetail(
      availableDetailDocument({
        sessionId,
        title: "fixture title",
        aggregateVersion: 1,
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
        turnTimings: [],
      }),
    );

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

    applySessionDetail(
      availableDetailDocument({
        sessionId: "s-delete-after-second-stop",
        title: "fixture title",
        aggregateVersion: 1,
        messages: [],
        turnTimings: [],
      }),
    );

    expect(activeSession.messages).toEqual([]);
    expect(activeSession.detailMessages).toEqual([]);
    expect(activeSession).not.toHaveProperty("turnTimings");
  });

  it("rejects an available session entry without turnTimings through the detail protocol", () => {
    const { applySessionDetail } = createApplySessionDetailHarness({
      sessionId: "s-no-timings",
      messages: [],
    });
    const { turnTimings: _omittedTurnTimings, ...entry } = availableDetailEntry({
      sessionId: "s-no-timings",
      title: "fixture title",
      aggregateVersion: 1,
      messages: [],
      turnTimings: [],
    });

    expect(() =>
      applySessionDetail({ exists: true, sessionId: "s-no-timings", sessions: [entry] }),
    ).toThrow(expect.objectContaining({ code: SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID }));
  });

  it("applies only the protocol facts of an unavailable session entry", () => {
    const unavailableReason = { code: "SESSION_PROTOCOL_INVALID", message: "invalid" };
    const { activeSession, applySessionDetail, turnRuntimeRegistry } =
      createApplySessionDetailHarness({ sessionId: "s-unavailable", messages: [] });

    applySessionDetail(
      unavailableDetailDocument({ sessionId: "s-unavailable", unavailableReason }),
    );

    expect(activeSession).toMatchObject({
      loaded: true,
      isUnavailable: true,
      availability: "unavailable",
      unavailableReason,
    });
    expect(turnRuntimeRegistry.value.sessions["s-unavailable"]).toBeUndefined();
  });
});
