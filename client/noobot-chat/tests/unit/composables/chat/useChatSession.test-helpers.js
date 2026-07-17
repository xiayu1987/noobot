/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { vi } from "vitest";
import { useChatSession } from "../../../../src/composables/chat/useChatSession";

export const wsClientMock = {
  connect: vi.fn(), dispose: vi.fn(), sendJson: vi.fn(), stream: vi.fn(),
  requestStop: vi.fn(), clearLastReceivedSeqMap: vi.fn(), clearStopRequested: vi.fn(),
  isStopRequested: vi.fn(() => false), reconnect: vi.fn(async () => {}),
};

export const sessionLogClientMock = {
  log: vi.fn(() => true), debug: vi.fn(() => true), dispose: vi.fn(),
};

export function createSessionFixture(overrides = {}) {
  return {
    id: "s-action-state", backendSessionId: "s-action-state", title: "session",
    isLocal: false, loaded: true, messages: [], rawMessages: [], sessionDocs: [],
    connectorPanelState: { selectedConnectors: {} }, currentTaskId: "",
    currentTaskStatus: "idle", messageCount: 0, lastMessage: null, createdAt: "", updatedAt: "",
    ...overrides,
  };
}

export function createChatSession(options = {}) {
  return useChatSession({
    userId: ref("u-1"), apiKey: ref(""), allowUserInteraction: ref(true), safeConfirm: ref(true),
    streamOutput: ref(true), botScenario: ref(""), connected: ref(true),
    ensureConnected: vi.fn(() => true), authFetch: null, isImageMime: () => false,
    classifyRealtimeLog: (item) => item, scrollBottom: vi.fn(), notify: vi.fn(),
    clearUploadSelection: vi.fn(), ...options,
  });
}

vi.mock("../../../../src/shared/i18n/useLocale", () => ({ useLocale: () => ({ translate: (key) => key }) }));
vi.mock("../../../../src/services/ws/chatWebSocketClient", () => ({ createChatWebSocketClient: () => wsClientMock }));
vi.mock("../../../../src/services/ws/sessionLogWebSocketClient", () => ({ createSessionLogWebSocketClient: () => sessionLogClientMock }));
