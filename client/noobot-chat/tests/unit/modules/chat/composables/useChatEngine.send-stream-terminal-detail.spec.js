/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { createHarness, emitChannelState } from "../helpers/useChatEngineHarness.js";
import { createSessionDetailApplicator } from "../../../../../src/modules/session/model/list/sessionDetailApply.js";
import { createTurnRuntimeStoreActions } from "../../../../../src/modules/chat/stores/chatStoreTurnRuntime.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

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
              terminalOutcome: "stopped",
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
    });
    const harness = createHarness({ sessionId: "local-stop-detail-preserve", stream });
    const sessions = ref([harness.activeSession.value]);
    const { applySessionDetail } = createSessionDetailApplicator({
      sessions,
      turnRuntimeRegistry: harness.turnRuntimeRegistry,
      chatStore: createTurnRuntimeStoreActions(harness.turnRuntimeRegistry, {
        onTurnCommitted: vi.fn(() => null),
        onTurnEvaluated: vi.fn(),
      }),
      makeViewMessage: (message) => ({ ...message }),
      sessionTitleFromMessages: () => "title",
      navigateToLastMessage: vi.fn(),
      onSessionDetailApplied: vi.fn(),
    });
    harness.deps.fetchSessionDetail = fetchSessionDetail;
    harness.deps.applySessionDetail = applySessionDetail;
    harness.activeSession.value.messages = [
      {
        messageUid: "msg-user-fresh",
        userMessageId: "msg-user-fresh",
        role: RoleEnum.USER,
        content: "edited question",
        turnScopeId: "client-turn:fresh",
        dialogProcessId: "dialog:client-turn:fresh",
      },
    ];

    await harness.engine.send({
      commandType: AGENT_COMMAND.RESEND,
      userMessageId: "msg-user-fresh",
      dialogProcessId: "dialog:client-turn:fresh",
      turnScopeId: "client-turn:fresh",
      messageText: "edited question",
      attachments: [],
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
