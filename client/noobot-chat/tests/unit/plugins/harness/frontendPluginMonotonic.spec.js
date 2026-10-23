/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  isMonotonicMessage,
  isUserMessage,
  resolveMonotonicMessageActionProps,
} from "../../../../src/modules/chat/model/message-actions/monotonicMessageActionRules.js";

describe("noobot-chat monotonic message action rules", () => {
  function getMonotonicAction() {
    return {
      match: isMonotonicMessage,
      resolveProps: resolveMonotonicMessageActionProps,
    };
  }

  function expectVisibleOnUserOnly(action, { userMessage, sourceMessage, allMessages }) {
    const deleteMonotonicMessage = vi.fn();
    const userProps = action.resolveProps({
      messageItem: userMessage,
      allMessages,
      deleteMonotonicMessage,
    });
    expect(userProps.visible).toBe(true);
    expect(userProps.messageItem).toBe(userMessage);
    expect(
      action.resolveProps({ messageItem: sourceMessage, allMessages, deleteMonotonicMessage })
        .visible,
    ).toBe(false);
  }

  it("ignores removed authorRole/senderRole/messageRole aliases when detecting user messages", () => {
    expect(isUserMessage({ authorRole: "user" })).toBe(false);
    expect(isUserMessage({ senderRole: "user" })).toBe(false);
    expect(isUserMessage({ messageRole: "user" })).toBe(false);
    expect(isUserMessage({ role: "user" })).toBe(true);
  });

  it("matches frontend stopped markers and runtime-written terminal facts", () => {
    const action = getMonotonicAction();

    expect(action.match({ isMonotonic: true })).toBe(true);
    expect(action.match({ monotonic: true })).toBe(true);
    expect(action.match({ monotonicState: "monotonic" })).toBe(true);
    expect(action.match({ stopState: "user_stopped" })).toBe(true);
    expect(action.match({ channelState: { state: "user_stopped" } })).toBe(true);
    expect(
      action.match({
        channelState: { state: "frontend_completed" },
        terminalOutcome: "generated",
      }),
    ).toBe(true);
    expect(action.match({ channelState: { state: "running" } })).toBe(false);
  });

  it("treats every channel/frontend terminal run state as terminal without an outcome", () => {
    const action = getMonotonicAction();
    for (const state of [
      "completed",
      "error",
      "expired",
      "no_conversation",
      "cancelled",
      "frontend_completed",
      "frontend_user_stop_completed",
      "frontend_processing_error",
    ])
      expect(action.match({ channelState: { state } })).toBe(true);
    for (const state of ["sending", "stopping", "stop_completed", "processing_failed", "aborted"])
      expect(action.match({ channelState: { state } })).toBe(false);
  });

  it("ignores message fields that have no runtime writer", () => {
    const action = getMonotonicAction();

    expect(action.match({ status: "completed" })).toBe(false);
    expect(action.match({ state: "user_stopped" })).toBe(false);
    expect(action.match({ channelState: "user_stopped" })).toBe(false);
    expect(action.match({ channelState: { status: "user_stopped" } })).toBe(false);
  });

  it("shows actions after stop when assistant channelState is an object", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const resendMonotonicMessage = vi.fn();
    const userMessage = {
      messageUid: "u-stopped-object",
      role: "user",
      turnScopeId: "turn-stopped-object",
      dialogProcessId: "dp-stopped-object",
      content: "stop me",
    };
    const stoppedAssistant = {
      presentationMessageId: "a-stopped-object",
      role: "assistant",
      turnScopeId: "turn-stopped-object",
      dialogProcessId: "dp-stopped-object",
      channelState: { state: "user_stopped", turnScopeId: "turn-stopped-object" },
    };
    const allMessages = [userMessage, stoppedAssistant];

    expect(action.match(stoppedAssistant)).toBe(true);
    const props = action.resolveProps({
      messageItem: userMessage,
      allMessages,
      deleteMonotonicMessage,
      resendMonotonicMessage,
    });
    expect(props.visible).toBe(true);
    expect(props.messageItem).toBe(userMessage);
    expect(props.onDelete).toBe(deleteMonotonicMessage);
    expect(props.onResend).toBe(resendMonotonicMessage);
    expect(
      action.resolveProps({ messageItem: stoppedAssistant, allMessages, deleteMonotonicMessage })
        .visible,
    ).toBe(false);
  });

  it("restores stopped actions in old sessions when round ids are only in assistant channelState", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const resendMonotonicMessage = vi.fn();
    const oldSessionId = "18c9be16-a197-4581-b0fb-7eee18cea005";
    const firstUser = {
      role: "user",
      sessionId: oldSessionId,
      turnScopeId: "client-turn:history-1",
      dialogProcessId: "dp-history-1",
      content: "history question",
    };
    const firstAssistant = {
      role: "assistant",
      sessionId: oldSessionId,
      turnScopeId: "client-turn:history-1",
      dialogProcessId: "dp-history-1",
      content: "history answer",
    };
    const targetUser = {
      role: "user",
      sessionId: oldSessionId,
      turnScopeId: "client-turn:mr4cncpk:522h4o4b",
      content: "全仓回归测试",
    };
    const stoppedAssistant = {
      role: "assistant",
      type: "message",
      pending: false,
      channelState: {
        state: "user_stopped",
        sessionId: oldSessionId,
        dialogProcessId: "3b2a4540-89c6-48bd-9cb2-4cde447ce582",
        turnScopeId: "client-turn:mr4cncpk:522h4o4b",
      },
      content: "",
    };
    const allMessages = [firstUser, firstAssistant, targetUser, stoppedAssistant];

    const props = action.resolveProps({
      messageItem: targetUser,
      allMessages,
      deleteMonotonicMessage,
      resendMonotonicMessage,
    });

    expect(action.match(stoppedAssistant)).toBe(true);
    expect(props.visible).toBe(true);
    expect(props.messageItem).toBe(targetUser);
    expect(
      action.resolveProps({
        messageItem: firstUser,
        allMessages,
        deleteMonotonicMessage,
      }).visible,
    ).toBe(false);
    expect(
      action.resolveProps({
        messageItem: stoppedAssistant,
        allMessages,
        deleteMonotonicMessage,
        resendMonotonicMessage,
      }).visible,
    ).toBe(false);
  });

  it("mounts monotonic actions only on the resolved user message", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const resendMonotonicMessage = vi.fn();
    const userMessage = {
      messageUid: "u1",
      role: "user",
      dialogProcessId: "dp-1",
      content: "original question",
    };
    const messageItem = {
      presentationMessageId: "m1",
      role: "assistant",
      dialogProcessId: "dp-1",
      channelState: { state: "frontend_completed" },
      terminalOutcome: "generated",
    };
    const allMessages = [userMessage, messageItem];

    expect(action.resolveProps({ messageItem, allMessages, deleteMonotonicMessage }).visible).toBe(
      false,
    );
    expect(action.resolveProps({ messageItem, allMessages, resendMonotonicMessage }).visible).toBe(
      false,
    );
    expect(
      action.resolveProps({ messageItem: userMessage, allMessages, deleteMonotonicMessage })
        .visible,
    ).toBe(true);
    expect(
      action.resolveProps({ messageItem: userMessage, allMessages, resendMonotonicMessage })
        .visible,
    ).toBe(true);
    expect(action.resolveProps({ messageItem }).visible).toBe(false);
    expect(
      action.resolveProps({
        messageItem: { id: "m2", channelState: { state: "running" } },
        deleteMonotonicMessage,
      }).visible,
    ).toBe(false);

    const props = action.resolveProps({
      messageItem: userMessage,
      allMessages,
      sending: true,
      deleteMonotonicMessage,
      resendMonotonicMessage,
    });
    expect(props.disabled).toBe(true);
    expect(props.onDelete).toBe(deleteMonotonicMessage);
    expect(props.onResend).toBe(resendMonotonicMessage);
    expect(props.messageItem).toBe(userMessage);
  });

  it("restores stopped single-turn actions after reload from persisted assistant state", () => {
    const action = getMonotonicAction();
    const userMessage = {
      messageUid: "u-reload-1",
      role: "user",
      turnScopeId: "client-turn:reload-1",
      dialogProcessId: "dp-reload-1",
      content: "你好",
    };
    const stoppedAssistant = {
      presentationMessageId: "turn-status-placeholder:client-turn:reload-1",
      role: "assistant",
      turnStatusPlaceholder: true,
      turnStatus: { status: "user_stopped" },
      turnScopeId: "client-turn:reload-1",
      dialogProcessId: "dp-reload-1",
    };
    const allMessages = [userMessage, stoppedAssistant];

    expectVisibleOnUserOnly(action, { userMessage, sourceMessage: stoppedAssistant, allMessages });
  });

  it("keeps actions on the tail orphan user message when backend fails before assistant reply", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const userMessage = {
      messageUid: "u-no-source",
      role: "user",
      content: "你好",
    };

    expect(
      action.resolveProps({
        messageItem: userMessage,
        allMessages: [userMessage],
        deleteMonotonicMessage,
      }).visible,
    ).toBe(true);
  });

  it("does not show orphan fallback actions on non-tail user messages", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const userMessage = {
      messageUid: "u-no-source-middle",
      role: "user",
      content: "你好",
    };
    const assistantMessage = {
      presentationMessageId: "a-after-orphan",
      role: "assistant",
      content: "later reply",
    };

    expect(
      action.resolveProps({
        messageItem: userMessage,
        allMessages: [userMessage, assistantMessage],
        deleteMonotonicMessage,
      }).visible,
    ).toBe(false);
  });

  it("keeps actions only on the latest same-round user in multi-turn sessions", () => {
    const action = getMonotonicAction();
    const firstUser = {
      messageUid: "u-1",
      role: "user",
      turnScopeId: "client-turn:multi-1",
      dialogProcessId: "dp-1",
      content: "first",
    };
    const firstAssistant = {
      presentationMessageId: "a-1",
      role: "assistant",
      turnScopeId: "client-turn:multi-1",
      dialogProcessId: "dp-1",
    };
    const targetUser = {
      messageUid: "u-2",
      role: "user",
      turnScopeId: "client-turn:multi-2",
      dialogProcessId: "dp-2",
      content: "second",
    };
    const targetAssistant = {
      presentationMessageId: "a-2",
      role: "assistant",
      turnScopeId: "client-turn:multi-2",
      dialogProcessId: "dp-2",
    };
    const allMessages = [firstUser, firstAssistant, targetUser, targetAssistant];
    const deleteMonotonicMessage = vi.fn();
    const resolve = (messageItem) =>
      action.resolveProps({
        messageItem,
        allMessages,
        messageRuntime: { state: "completed" },
        deleteMonotonicMessage,
      }).visible;

    expect(resolve(firstUser)).toBe(false);
    expect(resolve(targetUser)).toBe(true);
    expect(resolve(firstAssistant)).toBe(false);
    expect(resolve(targetAssistant)).toBe(false);
  });

  it("does not treat reloaded rounds as terminal without an authoritative runtime fact", () => {
    const action = getMonotonicAction();
    const userMessage = {
      role: "user",
      turnScopeId: "client-turn:no-runtime",
      content: "question",
    };
    const assistantMessage = {
      role: "assistant",
      turnScopeId: "client-turn:no-runtime",
      content: "answer",
    };
    const allMessages = [userMessage, assistantMessage];
    const deleteMonotonicMessage = vi.fn();

    expect(
      action.resolveProps({ messageItem: userMessage, allMessages, deleteMonotonicMessage })
        .visible,
    ).toBe(false);
  });

  it("matches persisted sources by turnScopeId when reloaded objects are not identical", () => {
    const action = getMonotonicAction();
    const userMessage = {
      turnScopeId: "client-turn:message-id",
      role: "user",
      dialogProcessId: "dp-message-id",
      content: "question",
    };
    const sameUserRenderItem = {
      turnScopeId: "client-turn:message-id",
      role: "user",
      dialogProcessId: "dp-message-id",
      content: "question",
    };
    const assistantMessage = {
      turnScopeId: "client-turn:message-id",
      role: "assistant",
      dialogProcessId: "dp-message-id",
      channelState: { state: "user_stopped" },
    };
    const allMessages = [userMessage, assistantMessage];
    const deleteMonotonicMessage = vi.fn();

    const props = action.resolveProps({
      messageItem: sameUserRenderItem,
      allMessages,
      deleteMonotonicMessage,
    });

    expect(props.visible).toBe(true);
    expect(props.messageItem).toBe(sameUserRenderItem);
  });

  it("keeps stopped actions after reload when transport and canonical turn identities differ", () => {
    const action = getMonotonicAction();
    const userMessage = {
      role: "user",
      sessionId: "session-canonical",
      turnScopeId: "workflow-node:client-turn:stop-after-refresh",
      content: "stop after refresh",
    };
    const stoppedAssistant = {
      role: "assistant",
      sessionId: "session-canonical",
      turnScopeId: "workflow-node_client-turn_stop-after-refresh",
      channelState: { state: "user_stopped" },
      pending: false,
    };
    const props = action.resolveProps({
      messageItem: { ...userMessage },
      allMessages: [userMessage, stoppedAssistant],
      deleteMonotonicMessage: vi.fn(),
      resendMonotonicMessage: vi.fn(),
    });

    expect(props.visible).toBe(true);
  });

  it("projects stopped actions from authoritative runtime when the assistant shell is still empty", () => {
    const action = getMonotonicAction();
    const userMessage = {
      role: "user",
      turnScopeId: "client-turn:runtime-stop",
      content: "stop while shell is empty",
    };
    const emptyAssistant = {
      role: "assistant",
      turnScopeId: "client-turn:runtime-stop",
      content: "",
      pending: false,
    };
    const props = action.resolveProps({
      messageItem: userMessage,
      allMessages: [userMessage, emptyAssistant],
      messageRuntime: { state: "user_stopped", terminal: true },
      deleteMonotonicMessage: vi.fn(),
      resendMonotonicMessage: vi.fn(),
    });

    expect(props.visible).toBe(true);
  });

  it("matches reloaded render copies by dialogProcessId with authoritative runtime state", () => {
    const action = getMonotonicAction();
    const userMessage = {
      ts: 1710000000000,
      role: "user",
      turnScopeId: "client-turn:ts",
      dialogProcessId: "dp-ts",
      content: "question",
    };
    const sameUserRenderItem = {
      ts: 1710000000000,
      role: "user",
      turnScopeId: "client-turn:ts",
      dialogProcessId: "dp-ts",
      content: "question",
    };
    const assistantMessage = {
      ts: 1710000001000,
      role: "assistant",
      turnScopeId: "client-turn:ts",
      dialogProcessId: "dp-ts",
    };
    const allMessages = [userMessage, assistantMessage];
    const deleteMonotonicMessage = vi.fn();

    expect(
      action.resolveProps({
        messageItem: sameUserRenderItem,
        allMessages,
        messageRuntime: { state: "completed" },
        deleteMonotonicMessage,
      }).visible,
    ).toBe(true);
  });

  it("falls back to adjacent previous user when persisted round ids are missing", () => {
    const action = getMonotonicAction();
    const userMessage = {
      messageUid: "u-adjacent",
      role: "user",
      content: "question",
    };
    const assistantMessage = {
      presentationMessageId: "a-adjacent",
      role: "assistant",
      channelState: { state: "user_stopped" },
    };
    const allMessages = [userMessage, assistantMessage];

    expectVisibleOnUserOnly(action, { userMessage, sourceMessage: assistantMessage, allMessages });
  });

  it("uses persisted user monotonic markers", () => {
    const action = getMonotonicAction();
    const userMessage = {
      messageUid: "u-persisted-marker",
      role: "user",
      stopState: "user_stopped",
      isMonotonic: true,
      content: "question",
    };
    const allMessages = [userMessage];
    const deleteMonotonicMessage = vi.fn();

    const props = action.resolveProps({
      messageItem: userMessage,
      allMessages,
      deleteMonotonicMessage,
    });
    expect(props.visible).toBe(true);
    expect(props.messageItem).toBe(userMessage);
  });
});
