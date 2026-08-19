/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createHarness, emitChannelState } from "../helpers/useChatEngineHarness.js";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

describe("useChatEngine.send-stream terminal detail", () => {
  it("preserves a fresh replacement turn instead of applying a stale stopped snapshot", async () => {
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
              stopState: "user_stopped",
              channelState: { state: "user_stopped", turnScopeId: staleStoppedTurnScopeId },
            },
          ],
        },
      ],
    }));
    const stream = vi.fn(async (payload, onEvent) => {
      replacementTurnScopeId = payload.identity.turnScopeId;
      emitChannelState(onEvent, "local-stop-detail-preserve", "dp-new", "user_stopped", {
        turnScopeId: payload.identity.turnScopeId,
      });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: {
          sessionId: "local-stop-detail-preserve",
          dialogProcessId: "dp-new",
          turnScopeId: payload.identity.turnScopeId,
        },
      });
    });
    const harness = createHarness({ sessionId: "local-stop-detail-preserve", stream });
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
      {
        id: "msg-user-fresh",
        messageId: "msg-user-fresh",
        role: RoleEnum.USER,
        content: "edited question",
        turnScopeId: "client-turn:fresh",
      },
    ];

    await harness.engine.send({
      content: "edited question",
      turnScopeId: "client-turn:fresh",
      reuseExistingUserTurn: true,
      userMessageId: "msg-user-fresh",
    });

    const messages = harness.activeSession.value.messages;
    expect(replacementTurnScopeId).toBe("client-turn:fresh");
    expect(messages.some((message) => message.turnScopeId === staleStoppedTurnScopeId)).toBe(false);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: RoleEnum.USER,
          content: "edited question",
          turnScopeId: "client-turn:fresh",
        }),
        expect.objectContaining({ role: RoleEnum.ASSISTANT, turnScopeId: "client-turn:fresh" }),
      ]),
    );
  });
});
