/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  finalizeStoppedSessionDetail,
  refreshFinalSessionDetail,
} from "../../../../../../src/modules/chat/runtime/engine/sessionFinalize.js";
import { RoleEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";

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

  it("does not restore a deleted Turn when an older stopped detail arrives", async () => {
    const turnScopeId = "client-turn:deleted-while-detail-pending";
    const activeSessionId = { value: "local-stop-delete-race" };
    const activeSession = {
      value: {
        id: activeSessionId.value,
        backendSessionId: activeSessionId.value,
        messages: [
          { role: RoleEnum.USER, content: "delete me", turnScopeId },
          { role: RoleEnum.ASSISTANT, content: "partial", turnScopeId },
        ],
      },
    };
    let resolveDetail;
    const fetchSessionDetail = vi.fn(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const applySessionDetail = vi.fn();

    const finalizing = finalizeStoppedSessionDetail({
      activeSession,
      activeSessionId,
      botMessage: activeSession.value.messages[1],
      finalEventData: { sessionId: activeSessionId.value, turnScopeId },
      fetchSessionDetail,
      applySessionDetail,
    });
    await vi.waitFor(() => expect(fetchSessionDetail).toHaveBeenCalledTimes(1));
    activeSession.value.messages = [];
    resolveDetail({
      sessionId: activeSessionId.value,
      sessions: [{
        sessionId: activeSessionId.value,
        messages: [
          { role: RoleEnum.USER, content: "delete me", turnScopeId },
          { role: RoleEnum.ASSISTANT, content: "stopped", turnScopeId },
        ],
      }],
    });

    await expect(finalizing).resolves.toBe(false);
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([]);
  });

  it("ignores the cancelled-stream error refresh after its Turn was deleted", async () => {
    const turnScopeId = "client-turn:cancelled-stream-delete-race";
    const activeSessionId = { value: "view-session" };
    const activeSession = {
      value: {
        id: "view-session",
        backendSessionId: "backend-session",
        messages: [
          { role: RoleEnum.USER, content: "delete me", turnScopeId },
          { role: RoleEnum.ASSISTANT, content: "stopping", turnScopeId },
        ],
      },
    };
    let resolveDetail;
    const fetchSessionDetail = vi.fn(() => new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    const applySessionDetail = vi.fn();

    const refresh = refreshFinalSessionDetail({
      activeSession,
      activeSessionId,
      botMessage: activeSession.value.messages[1],
      finalDoneEventData: {
        sessionId: "backend-session",
        turnScopeId,
      },
      fetchSessionDetail,
      applySessionDetail,
    });
    await vi.waitFor(() => expect(fetchSessionDetail).toHaveBeenCalledTimes(1));

    activeSession.value.messages = [];
    resolveDetail({
      sessionId: "backend-session",
      sessions: [{
        sessionId: "backend-session",
        messages: [
          { role: RoleEnum.USER, content: "delete me", turnScopeId },
          { role: RoleEnum.ASSISTANT, content: "stale answer", turnScopeId },
        ],
      }],
    });

    await expect(refresh).resolves.toBe(false);
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([]);
  });
});
