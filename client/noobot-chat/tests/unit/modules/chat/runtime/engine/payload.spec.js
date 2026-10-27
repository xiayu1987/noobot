/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { AGENT_COMMAND, ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";

import { buildChatPayload } from "../../../../../../src/modules/chat/runtime/engine/payload.js";

const PREFERENCE_VALUES = Object.freeze({
  allowUserInteraction: true,
  safeConfirm: true,
  safeConfirmLevel: "low",
  sanitizeOutput: true,
  botScenario: "",
  selectedModel: "",
  memoryModel: "",
  pluginModelConfig: null,
  frontendThresholdsEnabled: false,
  summaryPolicy: null,
  locale: "",
  selectedPlugins: [],
});

function sendRequest(overrides) {
  return {
    commandType: AGENT_COMMAND.SEND,
    turnScopeId: "turn-1",
    userMessageId: "msg_user-1",
    presentationMessageId: "msg_assistant-1",
    messageText: "hello",
    ...overrides,
  };
}

function continueRequest(overrides) {
  return sendRequest({
    commandType: AGENT_COMMAND.CONTINUE,
    continuation: { dialogProcessId: "dlg-stopped", turnScopeId: "turn-stopped" },
    ...overrides,
  });
}

function resendRequest(overrides) {
  return sendRequest({
    commandType: AGENT_COMMAND.RESEND,
    dialogProcessId: "dialog-resend",
    attachments: [],
    ...overrides,
  });
}

function buildPayload({ request, activeSession, preferences, ...options }) {
  const preferenceRefs = Object.fromEntries(
    Object.entries({ ...PREFERENCE_VALUES, ...preferences }).map(([key, value]) => [
      key,
      ref(value),
    ]),
  );
  return buildChatPayload({
    request,
    activeSession: {
      value: {
        sessionId: "session-1",
        parentSessionId: ROOT_PARENT_SESSION_ID,
        isLocal: false,
        connectorPanelState: { selectedConnectorIds: [] },
        ...activeSession,
      },
    },
    attachments: [],
    requestedTextStreaming: false,
    expectedAggregateVersion: 0,
    ...options,
    ...preferenceRefs,
  });
}

describe("buildChatPayload command contract", () => {
  it("grants session provision intent only to an initial send of a local session", () => {
    const local = { isLocal: true };
    expect(
      buildPayload({ request: sendRequest(), activeSession: local }).session.createIfAbsent,
    ).toBe(true);
    expect(buildPayload({ request: sendRequest() }).session.createIfAbsent).toBe(false);
    expect(
      buildPayload({ request: continueRequest(), activeSession: local }).session.createIfAbsent,
    ).toBe(false);
    expect(
      buildPayload({ request: resendRequest(), activeSession: local }).session.createIfAbsent,
    ).toBe(false);
  });

  it("dispatches the request commandType to the protocol command", () => {
    expect(buildPayload({ request: sendRequest() }).commandType).toBe(AGENT_COMMAND.SEND);
    expect(buildPayload({ request: continueRequest() }).commandType).toBe(AGENT_COMMAND.CONTINUE);
    expect(buildPayload({ request: resendRequest() }).commandType).toBe(AGENT_COMMAND.RESEND);
  });

  it("carries dialog identity only for resend", () => {
    expect(buildPayload({ request: resendRequest() }).identity).toMatchObject({
      sessionId: "session-1",
      dialogProcessId: "dialog-resend",
      turnScopeId: "turn-1",
    });
    expect(buildPayload({ request: sendRequest() }).identity).not.toHaveProperty("dialogProcessId");
    expect(buildPayload({ request: continueRequest() }).identity).not.toHaveProperty(
      "dialogProcessId",
    );
  });

  it("carries continuation only for continue", () => {
    expect(buildPayload({ request: continueRequest() }).continuation).toEqual({
      dialogProcessId: "dlg-stopped",
      turnScopeId: "turn-stopped",
    });
    expect(buildPayload({ request: sendRequest() })).not.toHaveProperty("continuation");
    expect(buildPayload({ request: resendRequest() })).not.toHaveProperty("continuation");
  });

  it("carries preallocated message identities once in presentation", () => {
    const payload = buildPayload({ request: sendRequest() });
    expect(payload.presentation).toEqual({
      userMessageId: "msg_user-1",
      presentationMessageId: "msg_assistant-1",
    });
    expect(payload).not.toHaveProperty("userMessageId");
    expect(payload).not.toHaveProperty("presentationMessageId");
  });

  it("keeps new Turn revision separate from the caller-owned session version", () => {
    const payload = buildPayload({ request: sendRequest(), expectedAggregateVersion: 7 });
    expect(payload.concurrency).toEqual({ expectedTurnRevision: 0, expectedAggregateVersion: 7 });
  });

  it("carries connector selection only as initial state for a new Session", () => {
    const connectorPanelState = { selectedConnectorIds: ["con_db"] };
    expect(
      buildPayload({
        request: sendRequest(),
        activeSession: { isLocal: true, connectorPanelState },
      }).session,
    ).toEqual({ createIfAbsent: true, selectedConnectorIds: ["con_db"] });
    expect(
      buildPayload({ request: sendRequest(), activeSession: { connectorPanelState } }).session,
    ).toEqual({ createIfAbsent: false, selectedConnectorIds: [] });
  });

  it("sends the resolved message text unchanged and lets the protocol reject empty text", () => {
    const attachments = [{ attachmentId: "att-1", name: "a.txt" }];
    expect(buildPayload({ request: continueRequest(), attachments }).input).toEqual({
      message: "hello",
      attachments,
    });
    expect(() => buildPayload({ request: sendRequest({ messageText: "" }), attachments })).toThrow(
      /missing_message/,
    );
  });

  it("passes composer preferences through to the protocol preferences", () => {
    const pluginModelConfig = { workflow: { semanticModel: "workflow-programming" } };
    const payload = buildPayload({
      request: sendRequest(),
      requestedTextStreaming: true,
      preferences: {
        safeConfirm: false,
        sanitizeOutput: false,
        safeConfirmLevel: "high",
        botScenario: "programming",
        selectedModel: "main-programming",
        memoryModel: "memory-programming",
        pluginModelConfig,
        frontendThresholdsEnabled: true,
        summaryPolicy: { phaseSummaryLoopTurns: 1 },
        locale: "zh-CN",
        selectedPlugins: [" harness ", "workflow", ""],
      },
    });
    expect(payload.preferences).toEqual({
      allowUserInteraction: true,
      safeConfirm: false,
      sanitizeOutput: false,
      streaming: true,
      frontendThresholdsEnabled: true,
      safeConfirmLevel: "high",
      locale: "zh-CN",
      scenario: "programming",
      selectedModel: "main-programming",
      memoryModel: "memory-programming",
      pluginModelConfig,
      summaryPolicy: { phaseSummaryLoopTurns: 1 },
      selectedPlugins: ["harness", "workflow"],
    });
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("config");
  });
});
