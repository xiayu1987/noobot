import { describe, expect, it, vi } from "vitest";
import { applyStopRequestedState } from "../../../../src/composables/chat/chatEngine/sendFinalize";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("sendFinalize", () => {
  it("marks the latest user message as stopped monotonic when stop is requested", () => {
    const userMessage = { role: RoleEnum.USER, content: "question" };
    const rawUserMessage = { role: RoleEnum.USER, content: "question" };
    const assistantMessage = {
      role: RoleEnum.ASSISTANT,
      content: "",
      dialogProcessId: "dp-stop",
    };
    const rawAssistantMessage = { ...assistantMessage };
    const activeSession = {
      value: {
        id: "session-stop",
        backendSessionId: "backend-stop",
        messages: [userMessage, assistantMessage],
        rawMessages: [rawUserMessage, rawAssistantMessage],
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
    expect(rawUserMessage.dialogProcessId).toBe("dp-stop");
    expect(rawUserMessage.stopState).toBe("stopped");
    expect(rawUserMessage.monotonicState).toBe("monotonic");
    expect(rawUserMessage.isMonotonic).toBe(true);
    expect(rawUserMessage.monotonic).toBe(true);
    expect(applyConversationState).toHaveBeenCalledWith(
      {
        state: "stopped",
        sessionId: "backend-stop",
        dialogProcessId: "dp-stop",
      },
      { botMessage: assistantMessage },
    );
  });
});
