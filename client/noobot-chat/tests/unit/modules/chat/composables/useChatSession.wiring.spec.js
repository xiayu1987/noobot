/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { createChatSession } from "./useChatSession.test-helpers.js";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";

const SESSION_ID = "s-wiring";
const TURN_SCOPE_ID = "client-turn:wiring";

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function createAuthFetch() {
  return vi.fn(async (url) => {
    if (String(url).startsWith("/api/internal/sessions/")) {
      return jsonResponse({
        ok: true,
        sessions: [
          { sessionId: SESSION_ID, parentSessionId: ROOT_PARENT_SESSION_ID, caller: RoleEnum.USER },
        ],
      });
    }
    if (String(url).startsWith(`/api/internal/session/u-1/${SESSION_ID}`)) {
      return jsonResponse({
        ok: true,
        exists: true,
        sessionId: SESSION_ID,
        sessions: [
          {
            sessionId: SESSION_ID,
            parentSessionId: ROOT_PARENT_SESSION_ID,
            caller: RoleEnum.USER,
            messages: [
              {
                messageUid: "wiring-user",
                userMessageId: "wiring-user",
                role: RoleEnum.USER,
                content: "q",
                turnScopeId: TURN_SCOPE_ID,
                dialogProcessId: "dp-wiring",
              },
            ],
            turnTimings: [
              {
                turnScopeId: TURN_SCOPE_ID,
                dialogProcessId: "dp-wiring",
                thinkingFinishedAt: "2026-07-15T10:00:05.000Z",
              },
            ],
          },
        ],
      });
    }
    return jsonResponse({ ok: true });
  });
}

describe("useChatSession production wiring", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads session detail through the assembled chat list and store", async () => {
    const authFetch = createAuthFetch();
    const notify = vi.fn();
    const chatSession = createChatSession({ authFetch, notify });

    await expect(
      chatSession.fetchSessions(SESSION_ID, { forceCurrentSessionRerender: true }),
    ).resolves.toBe(true);

    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(authFetch).toHaveBeenCalledWith(`/api/internal/session/u-1/${SESSION_ID}`);
    expect(
      chatSession.turnRuntimeRegistry.value.sessions[SESSION_ID].turns[TURN_SCOPE_ID],
    ).toMatchObject({ timing: { thinkingFinishedAt: "2026-07-15T10:00:05.000Z" } });
  });
});
