import { describe, expect, it, vi } from "vitest";
import { registerFrontendPlugin } from "../../../../../../plugin/noobot-plugin-harness/frontend/index.js";

describe("harness frontend monotonic message action registration", () => {
  function getMonotonicAction() {
    const registered = [];
    registerFrontendPlugin({ registerFrontendPlugin: (plugin) => registered.push(plugin) });
    const actionsPlugin = registered.find((plugin) => plugin.id === "message-actions");
    return actionsPlugin.messageActions.find((action) => action.capability === "message.action.monotonic");
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
    expect(action.resolveProps({ messageItem: sourceMessage, allMessages, deleteMonotonicMessage }).visible).toBe(false);
  }

  it("matches frontend stopped markers and backend completed session messages", () => {
    const action = getMonotonicAction();

    expect(action.match({ isMonotonic: true })).toBe(true);
    expect(action.match({ monotonic: true })).toBe(true);
    expect(action.match({ monotonicState: "monotonic" })).toBe(true);
    expect(action.match({ stopState: "stopped" })).toBe(true);
    expect(action.match({ status: "completed" })).toBe(true);
    expect(action.match({ state: "done" })).toBe(true);
    expect(action.match({ channelState: "stopped" })).toBe(true);
    expect(action.match({ channelState: { state: "stopped" } })).toBe(true);
    expect(action.match({ channelState: { status: "stopped" } })).toBe(true);
    expect(action.match({ statusLabel: "已生成" })).toBe(true);
    expect(action.match({ status: "running" })).toBe(false);
  });

  it("shows actions after stop when assistant channelState is an object", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const resendMonotonicMessage = vi.fn();
    const userMessage = {
      id: "u-stopped-object",
      role: "user",
      turnScopeId: "turn-stopped-object",
      dialogProcessId: "dp-stopped-object",
      content: "stop me",
    };
    const stoppedAssistant = {
      id: "a-stopped-object",
      role: "assistant",
      turnScopeId: "turn-stopped-object",
      dialogProcessId: "dp-stopped-object",
      channelState: { state: "stopped", turnScopeId: "turn-stopped-object" },
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
    expect(action.resolveProps({ messageItem: stoppedAssistant, allMessages, deleteMonotonicMessage }).visible).toBe(false);
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
      status: "completed",
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
        state: "stopped",
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
    expect(action.resolveProps({
      messageItem: firstUser,
      allMessages,
      deleteMonotonicMessage,
    }).visible).toBe(false);
    expect(action.resolveProps({
      messageItem: stoppedAssistant,
      allMessages,
      deleteMonotonicMessage,
      resendMonotonicMessage,
    }).visible).toBe(false);
  });

  it("mounts monotonic actions only on the resolved user message", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const resendMonotonicMessage = vi.fn();
    const userMessage = {
      id: "u1",
      role: "user",
      dialogProcessId: "dp-1",
      content: "original question",
    };
    const messageItem = {
      id: "m1",
      role: "assistant",
      dialogProcessId: "dp-1",
      status: "completed",
    };
    const allMessages = [userMessage, messageItem];

    expect(action.resolveProps({ messageItem, allMessages, deleteMonotonicMessage }).visible).toBe(false);
    expect(action.resolveProps({ messageItem, allMessages, resendMonotonicMessage }).visible).toBe(false);
    expect(action.resolveProps({ messageItem: userMessage, allMessages, deleteMonotonicMessage }).visible).toBe(true);
    expect(action.resolveProps({ messageItem: userMessage, allMessages, resendMonotonicMessage }).visible).toBe(true);
    expect(action.resolveProps({ messageItem }).visible).toBe(false);
    expect(action.resolveProps({ messageItem: { id: "m2", status: "running" }, deleteMonotonicMessage }).visible).toBe(false);

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
      id: "u-reload-1",
      role: "user",
      dialogProcessId: "dp-reload-1",
      content: "你好",
    };
    const stoppedAssistant = {
      id: "a-reload-1",
      role: "assistant",
      dialogProcessId: "dp-reload-1",
      state: "stopped",
    };
    const allMessages = [userMessage, stoppedAssistant];

    expectVisibleOnUserOnly(action, { userMessage, sourceMessage: stoppedAssistant, allMessages });
  });

  it("keeps actions on the tail orphan user message when backend fails before assistant reply", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const userMessage = {
      id: "u-no-source",
      role: "user",
      content: "你好",
    };

    expect(action.resolveProps({
      messageItem: userMessage,
      allMessages: [userMessage],
      deleteMonotonicMessage,
    }).visible).toBe(true);
  });

  it("does not show orphan fallback actions on non-tail user messages", () => {
    const action = getMonotonicAction();
    const deleteMonotonicMessage = vi.fn();
    const userMessage = {
      id: "u-no-source-middle",
      role: "user",
      content: "你好",
    };
    const assistantMessage = {
      id: "a-after-orphan",
      role: "assistant",
      content: "later reply",
    };

    expect(action.resolveProps({
      messageItem: userMessage,
      allMessages: [userMessage, assistantMessage],
      deleteMonotonicMessage,
    }).visible).toBe(false);
  });

  it("keeps actions only on the latest same-round user in multi-turn sessions", () => {
    const action = getMonotonicAction();
    const firstUser = {
      id: "u-1",
      role: "user",
      dialogProcessId: "dp-1",
      content: "first",
    };
    const firstAssistant = {
      id: "a-1",
      role: "assistant",
      dialogProcessId: "dp-1",
      status: "completed",
    };
    const targetUser = {
      id: "u-2",
      role: "user",
      dialogProcessId: "dp-2",
      content: "second",
    };
    const targetAssistant = {
      id: "a-2",
      role: "assistant",
      dialogProcessId: "dp-2",
      status: "completed",
    };
    const allMessages = [firstUser, firstAssistant, targetUser, targetAssistant];
    const deleteMonotonicMessage = vi.fn();

    expect(action.resolveProps({ messageItem: firstUser, allMessages, deleteMonotonicMessage }).visible).toBe(false);
    expect(action.resolveProps({ messageItem: targetUser, allMessages, deleteMonotonicMessage }).visible).toBe(true);
    expect(action.resolveProps({ messageItem: firstAssistant, allMessages, deleteMonotonicMessage }).visible).toBe(false);
    expect(action.resolveProps({ messageItem: targetAssistant, allMessages, deleteMonotonicMessage }).visible).toBe(false);
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
      channelState: "stopped",
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

  it("matches persisted sources by timestamp when ids are unavailable", () => {
    const action = getMonotonicAction();
    const userMessage = {
      ts: 1710000000000,
      role: "user",
      dialogProcessId: "dp-ts",
      content: "question",
    };
    const sameUserRenderItem = {
      ts: 1710000000000,
      role: "user",
      dialogProcessId: "dp-ts",
      content: "question",
    };
    const assistantMessage = {
      ts: 1710000001000,
      role: "assistant",
      dialogProcessId: "dp-ts",
      status: "done",
    };
    const allMessages = [userMessage, assistantMessage];
    const deleteMonotonicMessage = vi.fn();

    expect(action.resolveProps({
      messageItem: sameUserRenderItem,
      allMessages,
      deleteMonotonicMessage,
    }).visible).toBe(true);
  });

  it("falls back to adjacent previous user when persisted round ids are missing", () => {
    const action = getMonotonicAction();
    const userMessage = {
      id: "u-adjacent",
      role: "user",
      content: "question",
    };
    const assistantMessage = {
      id: "a-adjacent",
      role: "assistant",
      state: "stopped",
    };
    const allMessages = [userMessage, assistantMessage];

    expectVisibleOnUserOnly(action, { userMessage, sourceMessage: assistantMessage, allMessages });
  });

  it("uses persisted user monotonic markers", () => {
    const action = getMonotonicAction();
    const userMessage = {
      id: "u-persisted-marker",
      role: "user",
      stopState: "stopped",
      isMonotonic: true,
      content: "question",
    };
    const allMessages = [userMessage];
    const deleteMonotonicMessage = vi.fn();

    const props = action.resolveProps({ messageItem: userMessage, allMessages, deleteMonotonicMessage });
    expect(props.visible).toBe(true);
    expect(props.messageItem).toBe(userMessage);
  });
});
