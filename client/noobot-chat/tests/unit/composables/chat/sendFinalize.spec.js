import { describe, expect, it, vi } from "vitest";
import { applyStopRequestedState } from "../../../../src/composables/chat/chatEngine/sendFinalize";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("sendFinalize", () => {
  it("marks the latest user message as stopped monotonic when stop is requested", () => {
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
    });

    expect(applied).toBe(true);
    expect(userMessage.dialogProcessId).toBe("dp-stop");
    expect(userMessage.stopState).toBe("stopped");
    expect(userMessage.monotonicState).toBe("monotonic");
    expect(userMessage.isMonotonic).toBe(true);
    expect(userMessage.monotonic).toBe(true);
    expect(applyConversationState).toHaveBeenCalledWith(
      {
        state: "stopped",
        sessionId: "backend-stop",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
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
    expect(userMessage.stopState).toBeUndefined();
    expect(assistantMessage.pending).toBe(true);
    expect(applyConversationState).not.toHaveBeenCalled();
  });
});
