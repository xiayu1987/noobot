/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildChatPayload } from "../../../../../../src/modules/chat/runtime/engine/payload.js";

describe("buildChatPayload model preferences", () => {
  it("grants session provision intent only to an initial send", () => {
    expect(
      buildChatPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "new",
      }).session.createIfAbsent,
    ).toBe(true);
    expect(
      buildChatPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: false } },
        message: "existing",
      }).session.createIfAbsent,
    ).toBe(false);
    expect(
      buildChatPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "continue",
        continueFromStopped: true,
      }).session.createIfAbsent,
    ).toBe(false);
    expect(
      buildChatPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "resend",
        reuseExistingUserTurn: true,
        dialogProcessId: "dialog-resend",
      }).session.createIfAbsent,
    ).toBe(false);
  });

  it("disables text streaming by default", () => {
    expect(buildChatPayload({ message: "x" }).preferences.streaming).toBe(false);
    expect(buildChatPayload({ message: "x" }).preferences.frontendThresholdsEnabled).toBe(false);
  });

  it("enables output sanitization by default and sends an explicit opt-out", () => {
    expect(buildChatPayload({ message: "x" }).preferences.sanitizeOutput).toBe(true);
    expect(
      buildChatPayload({ message: "x", sanitizeOutput: false }).preferences.sanitizeOutput,
    ).toBe(false);
  });

  it("normalizes and sends the safety confirmation level", () => {
    expect(
      buildChatPayload({ message: "x", safeConfirmLevel: { value: "HIGH" } }).preferences
        .confirmationLevel,
    ).toBe("high");
    expect(
      buildChatPayload({ message: "x", safeConfirmLevel: "invalid" }).preferences.confirmationLevel,
    ).toBe("low");
  });
  it("writes selectedModel and current scenario pluginModelConfig to preferences", () => {
    const payload = buildChatPayload({
      userId: "admin",
      message: "hello",
      requestedTextStreaming: true,
      botScenario: "programming",
      selectedModel: "main-programming",
      memoryModel: "memory-programming",
      pluginModelConfig: {
        harness: {
          stepModels: { planning: "harness-programming" },
          guidance: {
            analysis: { turnsThreshold: 7 },
          },
          capabilityProfile: {
            planning: { enabled: false },
            guidance: { enabled: false },
            acceptance: { enabled: false },
          },
        },
        workflow: { semanticModel: "workflow-programming" },
      },
      locale: "zh-CN",
      selectedPlugins: { value: ["harness", "workflow"] },
    });

    expect(payload).toMatchObject({
      protocolVersion: 2,
      commandType: "turn.send",
      input: { message: "hello", attachments: [] },
      preferences: {
        scenario: "programming",
        selectedModel: "main-programming",
        memoryModel: "memory-programming",
        pluginModelConfig: {
          harness: {
            stepModels: { planning: "harness-programming" },
            guidance: {
              analysis: { turnsThreshold: 7 },
            },
            capabilityProfile: {
              planning: { enabled: false },
              guidance: { enabled: false },
              acceptance: { enabled: false },
            },
          },
          workflow: { semanticModel: "workflow-programming" },
        },
        selectedPlugins: ["harness", "workflow"],
      },
    });
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("config");
  });

  it("writes the canonical main-flow summary policy to preferences", () => {
    const payload = buildChatPayload({
      activeSession: { value: { sessionId: "session-1" } },
      message: "hello",
      turnScopeId: "turn-1",
      frontendThresholdsEnabled: true,
      summaryPolicy: { phaseSummaryLoopTurns: 1 },
    });

    expect(payload.preferences.summaryPolicy).toEqual({ phaseSummaryLoopTurns: 1 });
    expect(payload.preferences.frontendThresholdsEnabled).toBe(true);
  });

  it("accepts selectedPlugins as a plain array", () => {
    const payload = buildChatPayload({
      userId: "admin",
      message: "hello",
      selectedPlugins: [" harness ", "workflow", ""],
    });

    expect(payload.preferences.selectedPlugins).toEqual(["harness", "workflow"]);
  });

  it("carries the preallocated assistant message identity once in presentation", () => {
    const payload = buildChatPayload({
      message: "hello",
      turnScopeId: "turn-1",
      assistantMessageId: "  msg_assistant-1  ",
    });

    expect(payload.presentation.assistantMessageId).toBe("msg_assistant-1");
    expect(payload).not.toHaveProperty("presentationMessageId");
    expect(payload).not.toHaveProperty("assistantMessageId");
  });

  it("carries the preallocated user message identity once in presentation", () => {
    const payload = buildChatPayload({
      message: "hello",
      turnScopeId: "turn-1",
      userMessageId: "  msg_user-1  ",
    });

    expect(payload.presentation.userMessageId).toBe("msg_user-1");
    expect(payload).not.toHaveProperty("userMessageId");
  });

  it("keeps new Turn revision separate from the caller-owned session version", () => {
    const payload = buildChatPayload({
      message: "hello",
      turnScopeId: "turn-1",
      expectedAggregateVersion: 7,
    });

    expect(payload.concurrency.expectedTurnRevision).toBe(0);
    expect(payload.concurrency.expectedAggregateVersion).toBe(7);
  });

  it("carries connector selection only as initial state for a new Session", () => {
    const localPayload = buildChatPayload({
      activeSession: {
        value: {
          sessionId: "local-1",
          isLocal: true,
          connectorPanelState: { selectedConnectorIds: ["con_db"] },
        },
      },
      message: "hello",
      turnScopeId: "turn-1",
    });
    const persistedPayload = buildChatPayload({
      activeSession: {
        value: {
          sessionId: "persisted-1",
          isLocal: false,
          connectorPanelState: { selectedConnectorIds: ["con_db"] },
        },
      },
      message: "hello",
      turnScopeId: "turn-2",
    });

    expect(localPayload.session).toEqual({
      createIfAbsent: true,
      selectedConnectorIds: ["con_db"],
    });
    expect(persistedPayload.session).toEqual({
      createIfAbsent: false,
      selectedConnectorIds: [],
    });
  });

  it("carries the Session-committed resend dialog identity once in transport identity", () => {
    const payload = buildChatPayload({
      activeSession: { value: { sessionId: "session-1" } },
      message: "edited",
      reuseExistingUserTurn: true,
      dialogProcessId: "  dialog-resend  ",
      turnScopeId: "turn-resend",
    });
    expect(payload.identity).toMatchObject({
      sessionId: "session-1",
      dialogProcessId: "dialog-resend",
      turnScopeId: "turn-resend",
    });
  });

  it("builds independent continue payload with new turn and stopped snapshot identity", () => {
    const payload = buildChatPayload({
      userId: "admin",
      activeSession: { value: { sessionId: "s1" } },
      message: "continue question",
      continueFromStopped: true,
      turnScopeId: "turn-resume-new",
      resumeDialogProcessId: "dlg-stopped",
      resumeTurnScopeId: "turn-stopped",
      allowUserInteraction: true,
      safeConfirm: false,
      requestedTextStreaming: false,
      botScenario: "programming",
      selectedModel: "main-model",
      attachments: [{ attachmentId: "att-1", name: "a.txt" }],
    });

    expect(payload).toMatchObject({
      protocolVersion: 2,
      commandType: "turn.continue",
      identity: {
        sessionId: "s1",
        turnScopeId: "turn-resume-new",
      },
      input: {
        message: "continue question",
        attachments: [{ attachmentId: "att-1", name: "a.txt" }],
      },
      preferences: {
        safeConfirm: false,
        streaming: false,
        scenario: "programming",
        selectedModel: "main-model",
      },
      continuation: {
        dialogProcessId: "dlg-stopped",
        turnScopeId: "turn-stopped",
      },
    });
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("action");
    expect(payload).not.toHaveProperty("config");
  });
});
