/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyDoneMessagesPatch,
  reconcileDoneTurnSnapshot,
} from "../../../../../../src/modules/chat/runtime/engine/messagePatch.js";
import { applyDoneMessagesFromReconnect } from "../../../../../../src/modules/chat/runtime/reconnect/doneReplay.js";

describe("messagePatch", () => {
  it("applies done raw messages without adding legacy dialog identity", () => {
    const botMessage = {
      role: "assistant",
      dialogProcessId: "dp-current",
      content: "",
      attachments: [],
    };
    const activeSession = {
      value: {
        rawMessages: [],
        messages: [botMessage],
      },
    };
    const dataMessages = [
      { role: "user", content: "previous", dialogProcessId: "dp-prev" },
      { role: "assistant", content: "previous answer", dialogProcessId: "dp-prev" },
      { role: "user", content: "current", dialogProcessId: "dp-current" },
      { role: "assistant", content: "tool call", type: "tool_call", dialogProcessId: "dp-current" },
      { role: "tool", content: "tool result", dialogProcessId: "dp-current" },
      { role: "assistant", content: "current assistant", dialogProcessId: "dp-current" },
    ];

    applyDoneMessagesPatch({
      data: { messages: dataMessages, dialogProcessId: "dp-current" },
      botMessage,
      activeSession,
      makeViewMessage: (messageItem) => ({ ...messageItem }),
      foldMessagesForView: (messages) =>
        messages.filter((messageItem) => ["user", "assistant"].includes(messageItem.role)),
      mergeAssistantAttachments: () => {},
    });

    expect(activeSession.value.rawMessages).toEqual([]);
    expect(botMessage.legacyDialogIdentity).toBeUndefined();
    expect(botMessage.content).toBe("current assistant");
  });

  it("does not append workflow finalized messages from DONE into display messages", () => {
    const botMessage = {
      role: "assistant",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      content: "",
      attachments: [],
      pending: true,
    };
    const activeSession = {
      value: {
        rawMessages: [],
        messages: [
          { role: "user", content: "current", dialogProcessId: "dp-current", turnScopeId: "turn-current" },
          botMessage,
        ],
      },
    };
    const dataMessages = [
      { role: "user", content: "current", dialogProcessId: "dp-current", turnScopeId: "turn-current" },
      {
        role: "assistant",
        content: "workflow finalized",
        dialogProcessId: "dp-current",
        turnScopeId: "turn-current",
        workflowMessage: true,
        workflowMeta: { source: "workflow-plugin" },
      },
      {
        role: "assistant",
        content: "normal finalized",
        dialogProcessId: "dp-current",
        turnScopeId: "turn-current",
      },
    ];

    applyDoneMessagesPatch({
      data: { messages: dataMessages, dialogProcessId: "dp-current" },
      botMessage,
      activeSession,
      makeViewMessage: (messageItem) => ({ ...messageItem }),
      foldMessagesForView: (messages) => messages,
      mergeAssistantAttachments: () => {},
    });

    expect(activeSession.value.rawMessages).toEqual([]);
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((messageItem) => messageItem.workflowMessage === true)).toBe(false);
    expect(botMessage.content).toBe("normal finalized");
  });

  it("projects the same DONE snapshot identically through realtime and reconnect entries", () => {
    const data = {
      sessionId: "session-homomorphic",
      dialogProcessId: "dialog-homomorphic",
      turnScopeId: "turn-homomorphic",
      messages: [
        {
          role: "user",
          content: "run workflow",
          sessionId: "session-homomorphic",
          dialogProcessId: "dialog-homomorphic",
          turnScopeId: "turn-homomorphic",
        },
        {
          role: "assistant",
          type: "workflow",
          content: "workflow result",
          sessionId: "session-homomorphic",
          dialogProcessId: "dialog-homomorphic",
          turnScopeId: "turn-homomorphic",
          pluginMessage: true,
          pluginMeta: {
            source: "workflow-plugin",
            kind: "workflow",
            payload: { workflowRunId: "run-homomorphic" },
          },
        },
      ],
    };
    const newProjection = () => {
      const assistant = {
        role: "assistant",
        type: "message",
        content: "",
        sessionId: data.sessionId,
        dialogProcessId: data.dialogProcessId,
        turnScopeId: data.turnScopeId,
        pending: true,
        thinkingExpanded: true,
        attachments: [],
      };
      return {
        assistant,
        session: {
          value: {
            id: data.sessionId,
            backendSessionId: data.sessionId,
            title: "session",
            messages: [data.messages[0], assistant],
            sessionDocs: [],
          },
        },
      };
    };
    const makeViewMessage = (messageItem) => ({ ...messageItem });
    const foldMessagesForView = (messages) => messages;
    const mergeAssistantAttachments = (target, attachments) => {
      target.attachments = attachments;
    };
    const realtime = newProjection();
    applyDoneMessagesPatch({
      data,
      botMessage: realtime.assistant,
      activeSession: realtime.session,
      makeViewMessage,
      foldMessagesForView,
      mergeAssistantAttachments,
    });
    const reconnect = newProjection();
    applyDoneMessagesFromReconnect({
      activeSession: reconnect.session,
      activeSessionId: { value: data.sessionId },
      eventData: data,
      makeViewMessage,
      foldMessagesForView,
      mergeAssistantAttachments,
      applyCompletedToolLogsToMessages: () => {},
      sessionTitleFromMessages: () => "session",
      applyFoldedMessagesToActiveSession: () => {},
    });

    const comparable = (message) => ({
      role: message.role,
      type: message.type,
      content: message.content,
      sessionId: message.sessionId,
      dialogProcessId: message.dialogProcessId,
      turnScopeId: message.turnScopeId,
      pluginMessage: message.pluginMessage,
      pluginMeta: message.pluginMeta,
      pending: message.pending,
      thinkingExpanded: message.thinkingExpanded,
    });
    expect(comparable(reconnect.assistant)).toEqual(comparable(realtime.assistant));
    expect(reconnect.session.value.messages).toHaveLength(2);
  });

  it("inserts exactly one exact-Turn assistant when a replay projection has only the user", () => {
    const userMessage = {
      role: "user",
      content: "run workflow",
      sessionId: "session-insert",
      dialogProcessId: "dialog-insert",
      turnScopeId: "turn-insert",
    };
    const activeSession = { value: { messages: [userMessage] } };
    const data = {
      sessionId: "session-insert",
      dialogProcessId: "dialog-insert",
      turnScopeId: "turn-insert",
      messages: [
        userMessage,
        {
          role: "assistant",
          content: "final answer",
          sessionId: "session-insert",
          dialogProcessId: "dialog-insert",
          turnScopeId: "turn-insert",
        },
      ],
    };

    const first = reconcileDoneTurnSnapshot({
      data,
      activeSession,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages,
    });
    const second = reconcileDoneTurnSnapshot({
      data,
      activeSession,
      makeViewMessage: (message) => ({ ...message }),
      foldMessagesForView: (messages) => messages,
    });

    expect(first).toMatchObject({ applied: true, inserted: true });
    expect(second).toMatchObject({ applied: true, inserted: false });
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages[1]).toMatchObject({
      role: "assistant",
      content: "final answer",
      turnScopeId: "turn-insert",
    });
  });
});
