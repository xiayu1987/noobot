import { describe, expect, it } from "vitest";
import {
  reconcileStaleResendMessages,
  syncSessionMessageSummary,
} from "../../../../src/composables/chat/chatEngine/resendReconciler";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("resendReconciler", () => {
  it("does not remove refreshed replacement user message that reuses the old turnScopeId", () => {
    const oldUser = {
      role: RoleEnum.USER,
      content: "old text",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:00.000Z",
    };
    const oldAssistant = {
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      turnScopeId: "client-turn-resend",
      ts: "2026-06-22T10:00:01.000Z",
    };
    const refreshedReplacementUser = {
      role: RoleEnum.USER,
      content: "edited text",
      // Some backend refresh snapshots can keep the frontend turn scope for the
      // replacement turn. The reconciler must not treat turnScopeId alone as an
      // immutable identity of a deleted message; otherwise the chat navigator no
      // longer has the user turn after refresh.
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
      rawMessages: [oldUser, oldAssistant, refreshedReplacementUser, refreshedAssistant],
    };

    const result = reconcileStaleResendMessages(session, {
      anchorMessage: oldUser,
      originalStartIndex: 0,
      removedMessages: [oldUser, oldAssistant],
    }, { finalOnly: true });
    syncSessionMessageSummary(session);

    expect(result.changed).toBe(true);
    expect(session.messages).toEqual([refreshedReplacementUser, refreshedAssistant]);
    expect(session.rawMessages).toEqual([refreshedReplacementUser, refreshedAssistant]);
    expect(session.messageCount).toBe(2);
    expect(session.lastMessage).toBe(refreshedAssistant);
  });
});
