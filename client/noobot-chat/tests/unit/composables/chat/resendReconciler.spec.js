/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  reconcileStaleResendMessages,
  syncSessionMessageSummary,
} from "../../../../src/composables/chat/chatEngine/resendReconciler";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("resendReconciler", () => {
  it("prefers explicit turnScope replacement mapping and keeps replacement user", () => {
    const oldUser = {
      id: "old-user",
      role: RoleEnum.USER,
      content: "old text",
      turnScopeId: "client-turn-old",
      ts: "2026-06-22T10:00:00.000Z",
    };
    const oldAssistant = {
      id: "old-assistant",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      turnScopeId: "client-turn-old",
      ts: "2026-06-22T10:00:01.000Z",
    };
    const replacementUser = {
      id: "new-user",
      role: RoleEnum.USER,
      content: "edited text",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:05.000Z",
    };
    const replacementAssistant = {
      id: "new-assistant",
      role: RoleEnum.ASSISTANT,
      content: "new answer",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:06.000Z",
    };
    const session = {
      messages: [oldUser, oldAssistant, replacementUser, replacementAssistant],
    };

    const result = reconcileStaleResendMessages(session, {
      anchorMessage: oldUser,
      originalStartIndex: 0,
      removedMessages: [oldUser, oldAssistant],
      turnScopeReplacement: {
        replacedTurnScopeIds: ["client-turn-old"],
        replacementTurnScopeId: "client-turn-resend",
        replacementTurnScopeIds: ["client-turn-resend"],
      },
    }, { finalOnly: true });

    expect(result.changed).toBe(true);
    expect(session.messages).toEqual([replacementUser, replacementAssistant]);
  });

  it("removes stale messages by old turnScopeId when replacement uses a new turnScopeId", () => {
    const oldUser = {
      role: RoleEnum.USER,
      content: "old text",
      turnScopeId: "client-turn-old",
      ts: "2026-06-22T10:00:00.000Z",
    };
    const oldAssistant = {
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      turnScopeId: "client-turn-old",
      ts: "2026-06-22T10:00:01.000Z",
    };
    const refreshedReplacementUser = {
      role: RoleEnum.USER,
      content: "edited text",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:05.000Z",
    };
    const refreshedAssistant = {
      role: RoleEnum.ASSISTANT,
      content: "new answer",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:06.000Z",
    };
    const session = {
      messages: [oldUser, oldAssistant, refreshedReplacementUser, refreshedAssistant],
    };

    const result = reconcileStaleResendMessages(session, {
      anchorMessage: oldUser,
      status: "reconciling",
      originalStartIndex: 0,
      removedMessages: [oldUser, oldAssistant],
    }, { finalOnly: true });
    syncSessionMessageSummary(session);

    expect(result.changed).toBe(true);
    expect(session.messages).toEqual([refreshedReplacementUser, refreshedAssistant]);
    expect(session.messageCount).toBe(2);
    expect(session.lastMessage).toBe(refreshedAssistant);
  });

  it("syncs lastMessage to the latest visible message instead of a harness injected relay", () => {
    const userMessage = { role: RoleEnum.USER, content: "question" };
    const assistantMessage = { role: RoleEnum.ASSISTANT, content: "answer" };
    const harnessRelay = {
      role: RoleEnum.USER,
      content: "[Relay from harness external model/planning] hidden",
      injectedMessage: true,
      injectedBy: "harness-plugin",
    };
    const session = {
      messages: [userMessage, assistantMessage, harnessRelay],
    };

    syncSessionMessageSummary(session);

    expect(session.messageCount).toBe(3);
    expect(session.lastMessage).toBe(assistantMessage);
  });
});
