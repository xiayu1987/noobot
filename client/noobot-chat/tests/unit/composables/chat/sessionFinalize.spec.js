import { describe, expect, it, vi } from "vitest";
import {
  refreshFinalSessionDetail,
} from "../../../../src/composables/chat/chatEngine/sessionFinalize";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("sessionFinalize", () => {
  it("refreshes the current session after a stopped final event", async () => {
    const activeSession = {
      value: {
        id: "view-session",
        backendSessionId: "backend-session",
        messages: [
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "dp-stop",
            executionLogTotal: 1,
          },
        ],
        rawMessages: [],
      },
    };
    const detail = {
      id: "backend-session",
      messages: [
        {
          role: RoleEnum.ASSISTANT,
          dialogProcessId: "dp-stop",
          executionLogTotal: 0,
        },
      ],
    };
    const fetchSessionDetail = vi.fn().mockResolvedValue(detail);
    const applySessionDetail = vi.fn();
    const refreshSessionConnectorsAsync = vi.fn();

    const refreshed = await refreshFinalSessionDetail({
      activeSession,
      activeSessionId: { value: "view-session" },
      botMessage: activeSession.value.messages[0],
      finalEventData: {
        sessionId: "backend-session",
        dialogProcessId: "dp-stop",
      },
      fetchSessionDetail,
      applySessionDetail,
      refreshSessionConnectorsAsync,
    });

    expect(refreshed).toBe(true);
    expect(fetchSessionDetail).toHaveBeenCalledWith("backend-session");
    expect(applySessionDetail).toHaveBeenCalledWith(detail, {
      preserveCurrentMessages: true,
      scrollToBottom: false,
    });
    expect(activeSession.value.messages[0].executionLogTotal).toBe(1);
    expect(refreshSessionConnectorsAsync).toHaveBeenCalledWith("view-session");
  });

  it("allows stopped final refresh to replace current messages", async () => {
    const activeSession = {
      value: {
        id: "view-session",
        backendSessionId: "backend-session",
        messages: [
          {
            role: RoleEnum.ASSISTANT,
            dialogProcessId: "dp-stop",
            content: "local partial",
          },
        ],
        rawMessages: [],
      },
    };
    const detail = {
      sessionId: "backend-session",
      sessions: [
        {
          sessionId: "backend-session",
          messages: [
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-stop",
              content: "persisted stopped answer",
            },
          ],
        },
      ],
    };
    const fetchSessionDetail = vi.fn().mockResolvedValue(detail);
    const applySessionDetail = vi.fn();

    await refreshFinalSessionDetail({
      activeSession,
      activeSessionId: { value: "view-session" },
      botMessage: activeSession.value.messages[0],
      finalEventData: {
        sessionId: "backend-session",
        dialogProcessId: "dp-stop",
      },
      fetchSessionDetail,
      applySessionDetail,
      preserveCurrentMessages: false,
    });

    expect(applySessionDetail).toHaveBeenCalledWith(detail, {
      preserveCurrentMessages: false,
      scrollToBottom: false,
    });
  });
});
