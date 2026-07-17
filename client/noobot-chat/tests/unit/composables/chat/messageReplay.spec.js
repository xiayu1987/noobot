/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyFoldedMessagesForDialogProcess,
  applyFoldedMessagesToActiveSession,
} from "../../../../src/composables/chat/reconnectReplay/messageReplay";

describe("messageReplay", () => {
  it("patches an existing pending assistant for a reconnect DONE dialog process", () => {
    const pendingAssistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      content: "",
      attachments: [],
    };
    const activeSession = {
      value: {
        messages: [
          { role: "user", content: "question", turnScopeId: "turn-1" },
          pendingAssistant,
        ],
      },
    };

    const result = applyFoldedMessagesForDialogProcess(
      activeSession,
      [
        {
          role: "assistant",
          pending: false,
          dialogProcessId: "dp-1",
          turnScopeId: "turn-1",
          content: "final answer",
          attachments: [{ fileName: "answer.txt", url: "/answer.txt" }],
        },
      ],
      "dp-1",
    );

    expect(result).toBe(activeSession.value.messages);
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[1]).toBe(pendingAssistant);
    expect(activeSession.value.messages[1]).toMatchObject({
      pending: false,
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      content: "final answer",
      attachments: [{ fileName: "answer.txt", url: "/answer.txt" }],
    });
  });

  it("does not append missing finalized reconnect DONE assistants as a second completed-message source", () => {
    const activeSession = {
      value: {
        messages: [
          { role: "user", content: "existing question", turnScopeId: "turn-existing" },
          {
            role: "assistant",
            pending: true,
            dialogProcessId: "dp-in-flight",
            turnScopeId: "turn-in-flight",
            content: "",
          },
        ],
      },
    };

    applyFoldedMessagesForDialogProcess(
      activeSession,
      [
        {
          role: "assistant",
          pending: false,
          dialogProcessId: "dp-missing",
          turnScopeId: "turn-missing",
          content: "final answer from reconnect snapshot",
          attachments: [{ fileName: "snapshot.txt", url: "/snapshot.txt" }],
        },
      ],
      "dp-missing",
    );

    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((messageItem) =>
      messageItem.dialogProcessId === "dp-missing" || messageItem.content === "final answer from reconnect snapshot",
    )).toBe(false);
  });

  it("can still replace the whole active session when no dialog process overlay is requested", () => {
    const activeSession = {
      value: {
        messages: [{ role: "assistant", pending: true, content: "old" }],
      },
    };

    applyFoldedMessagesToActiveSession(activeSession, [
      { role: "user", content: "question" },
      { role: "assistant", pending: false, content: "answer" },
    ]);

    expect(activeSession.value.messages.map((messageItem) => messageItem.content)).toEqual([
      "question",
      "answer",
    ]);
  });
});
