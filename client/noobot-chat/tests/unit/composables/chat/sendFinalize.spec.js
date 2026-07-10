import { describe, expect, it, vi } from "vitest";
import { applyStopRequestedState } from "../../../../src/composables/chat/chatEngine/sendFinalize";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("sendFinalize", () => {
  it("applies the runtime stop state without mutating persisted message state", () => {
    const userMessage = { role: RoleEnum.USER, content: "question", turnScopeId: "turn-stop" };
    const assistantMessage = {
      role: RoleEnum.ASSISTANT,
      content: "",
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
    };
    const activeSession = {
      value: {
        id: "session-stop",
        backendSessionId: "backend-stop",
        messages: [userMessage, assistantMessage],
      },
    };
    const applyConversationState = vi.fn();

    const applied = applyStopRequestedState({
      chatWebSocketClient: { isStopRequested: () => true },
      activeSession,
      botMessage: assistantMessage,
      applyConversationState,
      backendStopEventData: {
        sessionId: "backend-stop",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
        sourceEvent: "backend_stopped",
      },
    });

    expect(applied).toBe(true);
    expect(userMessage).toEqual({
      role: RoleEnum.USER,
      content: "question",
      turnScopeId: "turn-stop",
    });
    expect(applyConversationState).toHaveBeenCalledWith(
      {
        state: "user_stopped",
        sessionId: "backend-stop",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
        sourceEvent: "backend_stopped",
      },
      { botMessage: assistantMessage },
    );
  });

  it("ignores a stale stop request from another turnScopeId", () => {
    const userMessage = { role: RoleEnum.USER, content: "new question", turnScopeId: "turn-new" };
    const assistantMessage = {
      role: RoleEnum.ASSISTANT,
      content: "",
      turnScopeId: "turn-new",
      pending: true,
    };
    const activeSession = {
      value: {
        id: "session-stop",
        backendSessionId: "backend-stop",
        messages: [userMessage, assistantMessage],
        rawMessages: [userMessage, assistantMessage],
      },
    };
    const applyConversationState = vi.fn();

    const applied = applyStopRequestedState({
      chatWebSocketClient: {
        isStopRequested: () => true,
        getStopRequestedTurnScopeId: () => "turn-old",
      },
      activeSession,
      botMessage: assistantMessage,
      applyConversationState,
    });

    expect(applied).toBe(false);
    expect(userMessage).toEqual({ role: RoleEnum.USER, content: "new question", turnScopeId: "turn-new" });
    expect(assistantMessage.pending).toBe(true);
    expect(applyConversationState).not.toHaveBeenCalled();
  });
});
