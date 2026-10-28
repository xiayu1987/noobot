/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, shallowRef } from "vue";

vi.mock("../../../src/modules/chat/runtime/engine/turnPresentation.js", () => ({
  selectTurnPresentations: ({ activeSession }) => activeSession.messages,
}));

const { useChatMessageNavigatorPanel } =
  await import("../../../src/app/composables/useChatMessageNavigatorPanel.js");
const { getMessageAnchorId } = await import("../../../src/modules/chat/model/messageAnchor.js");

const TURN_1 = "client-turn:00000000-0000-4000-8000-000000000001";
const TURN_2 = "client-turn:00000000-0000-4000-8000-000000000002";
const TURN_MISSING = "client-turn:00000000-0000-4000-8000-000000000099";

function message(turnScopeId, role, content) {
  return { role, sessionId: "session-1", turnScopeId, content };
}

const MESSAGES = [
  message(TURN_1, "user", "q1"),
  message(TURN_1, "assistant", "a1"),
  message(TURN_2, "user", "q2"),
  message(TURN_2, "assistant", "a2"),
];

function anchorOf(index) {
  return getMessageAnchorId(MESSAGES[index], index);
}

function createHarness({ activeTurnScopeId = "" } = {}) {
  const wrap = document.createElement("div");
  document.body.appendChild(wrap);
  const messageListPanel = {
    getWrapRef: () => wrap,
    scrollToMessageAnchor: vi.fn(),
    resolveCurrentMessageAnchorId: vi.fn(() => ""),
  };
  const activeSession = shallowRef({ sessionId: "session-1", loaded: false, messages: [] });
  const activeSessionId = ref("session-1");
  const turnRuntimeRegistry = ref({
    sessions: { "session-1": { activeTurnScopeId, turns: {} } },
  });
  const pushPseudoRoute = vi.fn();
  const scope = effectScope();
  const panel = scope.run(() =>
    useChatMessageNavigatorPanel({
      activeSession,
      activeSessionId,
      workflowNodeStateRegistry: ref({}),
      turnRuntimeRegistry,
      shouldRenderMessageInChat: () => true,
      messageListPanelRef: shallowRef(messageListPanel),
      isMobile: ref(false),
      translate: (key) => key,
      chatNavigatorPanel: "chatNavigator",
      pushPseudoRoute,
      replacePseudoRoute: vi.fn(),
    }),
  );
  async function load() {
    activeSession.value = { sessionId: "session-1", loaded: true, messages: MESSAGES };
    await nextTick();
  }
  async function setMessages(messages) {
    activeSession.value = { sessionId: "session-1", loaded: true, messages };
    await nextTick();
  }
  return {
    panel,
    scope,
    wrap,
    messageListPanel,
    activeSessionId,
    pushPseudoRoute,
    load,
    setMessages,
  };
}

let harness = null;

afterEach(() => {
  harness.scope.stop();
  harness.wrap.remove();
  harness = null;
});

describe("useChatMessageNavigatorPanel navigation", () => {
  it("navigates to the latest turn start only after the session is loaded", async () => {
    harness = createHarness();
    harness.panel.requestSessionNavigation("session-1");
    await nextTick();
    expect(harness.messageListPanel.scrollToMessageAnchor).not.toHaveBeenCalled();

    await harness.load();
    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledTimes(1);
    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(2));
    expect(harness.pushPseudoRoute).not.toHaveBeenCalled();
  });

  it("navigates to the running turn when the URL has no turn", async () => {
    harness = createHarness({ activeTurnScopeId: TURN_1 });
    harness.panel.requestSessionNavigation("session-1");
    await harness.load();

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(0));
  });

  it("prefers the URL turn over the running turn", async () => {
    harness = createHarness({ activeTurnScopeId: TURN_2 });
    harness.panel.applyRoutedTurn({ sessionId: "session-1", turnScopeId: TURN_1 });
    harness.panel.requestSessionNavigation("session-1");
    await harness.load();

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(0));
  });

  it("falls back to the running turn when the URL turn is not in the session", async () => {
    harness = createHarness({ activeTurnScopeId: TURN_1 });
    harness.panel.applyRoutedTurn({ sessionId: "session-1", turnScopeId: TURN_MISSING });
    harness.panel.requestSessionNavigation("session-1");
    await harness.load();

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(0));
    expect(harness.panel.routedTurnScopeId.value).toBe("");
  });

  it("navigates a turn request to the start of that turn", async () => {
    harness = createHarness();
    await harness.load();
    harness.panel.requestTurnNavigation({ sessionId: "session-1", turnScopeId: TURN_2 });
    await nextTick();

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(2));
  });

  it("drops a request for a session that is no longer active", async () => {
    harness = createHarness();
    harness.panel.requestSessionNavigation("session-1");
    harness.activeSessionId.value = "session-2";
    await nextTick();
    harness.activeSessionId.value = "session-1";
    await harness.load();

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledTimes(1);
  });

  it("user selection writes the item turn into the pseudo route", async () => {
    harness = createHarness();
    await harness.load();
    harness.panel.handleSelectChatMessageNavItem(harness.panel.chatMessageNavItems.value[2]);

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(anchorOf(2));
    expect(harness.pushPseudoRoute).toHaveBeenCalledWith({
      sessionId: "session-1",
      panel: "",
      turn: TURN_2,
    });
    expect(harness.panel.routedTurnScopeId.value).toBe(TURN_2);
  });
});

describe("useChatMessageNavigatorPanel turn requests", () => {
  it("keeps a turn request pending until the turn enters the navigator items", async () => {
    harness = createHarness();
    await harness.load();
    harness.panel.requestTurnNavigation({ sessionId: "session-1", turnScopeId: TURN_MISSING });
    await nextTick();
    expect(harness.messageListPanel.scrollToMessageAnchor).not.toHaveBeenCalled();

    const lateMessages = [...MESSAGES, message(TURN_MISSING, "assistant", "late")];
    await harness.setMessages(lateMessages);

    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledTimes(1);
    expect(harness.messageListPanel.scrollToMessageAnchor).toHaveBeenCalledWith(
      getMessageAnchorId(lateMessages[4], 4),
    );
  });
});
