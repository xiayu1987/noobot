/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";
import { vi } from "vitest";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";
import { useChatSession } from "../../../../../src/modules/chat/composables/useChatSession.js";
import { rejectUnexpectedRequest } from "../../../helpers/jsonResponse.js";

export const wsClientMock = {
  connect: vi.fn(),
  dispose: vi.fn(),
  sendJson: vi.fn(),
  requestJson: vi.fn(),
  stream: vi.fn(),
  requestStop: vi.fn(),
  cancelStreamForTurn: vi.fn(),
  clearLastReceivedSeqMap: vi.fn(),
  reconnect: vi.fn(async () => {}),
};

export const sessionLogClientMock = {
  log: vi.fn(() => true),
  debug: vi.fn((_debugType, factory) => factory()),
  isEnabled: vi.fn(() => true),
  dispose: vi.fn(),
};

export function createSessionFixture(overrides = {}) {
  return {
    id: "s-action-state",
    sessionId: "s-action-state",
    parentSessionId: ROOT_PARENT_SESSION_ID,
    title: "session",
    isLocal: false,
    loaded: true,
    aggregateVersion: 0,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    connectorPanelState: { selectedConnectorIds: [], connectors: [] },
    currentTaskId: "",
    currentTaskStatus: "idle",
    messageCount: 0,
    lastMessage: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

export function createChatSession(options = {}) {
  return useChatSession({
    userId: ref("u-1"),
    apiKey: ref(""),
    allowUserInteraction: ref(true),
    safeConfirm: ref(true),
    safeConfirmLevel: ref("low"),
    sanitizeOutput: ref(true),
    streamOutput: ref(true),
    botScenario: ref(""),
    selectedModel: ref(""),
    memoryModel: ref(""),
    pluginModelConfig: ref({}),
    frontendThresholdsEnabled: ref(false),
    summaryPolicy: ref({}),
    selectedPlugins: ref([]),
    connected: ref(true),
    ensureConnected: vi.fn(() => true),
    authFetch: vi.fn(rejectUnexpectedRequest),
    requestTurnNavigation: vi.fn(),
    requestSessionNavigation: vi.fn(),
    isImageMime: () => false,
    notify: vi.fn(),
    clearUploadSelection: vi.fn(),
    ...options,
  });
}

vi.mock("../../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({ translate: (key) => key, locale: { value: "zh-CN" } }),
}));
vi.mock("../../../../../src/infrastructure/websocket/chatWebSocketClient", () => ({
  createChatWebSocketClient: () => wsClientMock,
}));
vi.mock("../../../../../src/infrastructure/websocket/sessionLogWebSocketClient", () => ({
  createSessionLogWebSocketClient: () => sessionLogClientMock,
}));
