/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { buildChatPayload } from "../../../../../../src/modules/chat/runtime/engine/payload.js";

const PREFERENCE_DEFAULTS = Object.freeze({
  allowUserInteraction: undefined,
  safeConfirm: undefined,
  safeConfirmLevel: undefined,
  sanitizeOutput: undefined,
  botScenario: "",
  selectedModel: "",
  memoryModel: "",
  pluginModelConfig: null,
  frontendThresholdsEnabled: false,
  summaryPolicy: null,
  locale: "",
  selectedPlugins: [],
});

function buildRequiredPayload(options) {
  const preferenceRefs = Object.fromEntries(
    Object.entries(PREFERENCE_DEFAULTS).map(([key, fallback]) => [
      key,
      ref(key in options ? options[key] : fallback),
    ]),
  );
  return buildChatPayload({
    activeSession: { value: { sessionId: "session-1", isLocal: false } },
    userMessageId: `user-message:${options.turnScopeId}`,
    presentationMessageId: `assistant-message:${options.turnScopeId}`,
    expectedAggregateVersion: 0,
    ...options,
    ...preferenceRefs,
  });
}

describe("buildChatPayload model preferences", () => {
  it("grants session provision intent only to an initial send", () => {
    expect(
      buildRequiredPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "new",
        turnScopeId: "turn-1",
      }).session.createIfAbsent,
    ).toBe(true);
    expect(
      buildRequiredPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: false } },
        message: "existing",
        turnScopeId: "turn-1",
      }).session.createIfAbsent,
    ).toBe(false);
    expect(
      buildRequiredPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "continue",
        turnScopeId: "turn-1",
        continueFromStopped: true,
        resumeDialogProcessId: "dlg-stopped",
        resumeTurnScopeId: "turn-stopped",
      }).session.createIfAbsent,
    ).toBe(false);
    expect(
      buildRequiredPayload({
        activeSession: { value: { sessionId: "session-1", isLocal: true } },
        message: "resend",
        turnScopeId: "turn-1",
        reuseExistingUserTurn: true,
        dialogProcessId: "dialog-resend",
      }).session.createIfAbsent,
    ).toBe(false);
  });

  it("disables text streaming by default", () => {
    expect(
      buildRequiredPayload({ message: "x", turnScopeId: "turn-1" }).preferences.streaming,
    ).toBe(false);
    expect(
      buildRequiredPayload({ message: "x", turnScopeId: "turn-1" }).preferences
        .frontendThresholdsEnabled,
    ).toBe(false);
  });

  it("enables output sanitization by default and sends an explicit opt-out", () => {
    expect(
      buildRequiredPayload({ message: "x", turnScopeId: "turn-1" }).preferences.sanitizeOutput,
    ).toBe(true);
    expect(
      buildRequiredPayload({ message: "x", turnScopeId: "turn-1", sanitizeOutput: false })
        .preferences.sanitizeOutput,
    ).toBe(false);
  });

  it("normalizes and sends the safety confirmation level", () => {
    expect(
      buildRequiredPayload({
        message: "x",
        turnScopeId: "turn-1",
        safeConfirmLevel: "HIGH",
      }).preferences.confirmationLevel,
    ).toBe("high");
    expect(
      buildRequiredPayload({ message: "x", turnScopeId: "turn-1", safeConfirmLevel: "invalid" })
        .preferences.confirmationLevel,
    ).toBe("low");
  });
  it("writes selectedModel and current scenario pluginModelConfig to preferences", () => {
    const payload = buildRequiredPayload({
      userId: "admin",
      message: "hello",
      turnScopeId: "turn-1",
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
      selectedPlugins: [" harness ", "workflow", ""],
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
    const payload = buildRequiredPayload({
      activeSession: { value: { sessionId: "session-1" } },
      message: "hello",
      turnScopeId: "turn-1",
      frontendThresholdsEnabled: true,
      summaryPolicy: { phaseSummaryLoopTurns: 1 },
    });

    expect(payload.preferences.summaryPolicy).toEqual({ phaseSummaryLoopTurns: 1 });
    expect(payload.preferences.frontendThresholdsEnabled).toBe(true);
  });

  it("carries the preallocated assistant message identity once in presentation", () => {
    const payload = buildRequiredPayload({
      message: "hello",
      turnScopeId: "turn-1",
      presentationMessageId: "  msg_assistant-1  ",
    });

    expect(payload.presentation.presentationMessageId).toBe("msg_assistant-1");
    expect(payload).not.toHaveProperty("presentationMessageId");
    expect(payload).not.toHaveProperty("presentationMessageId");
  });

  it("carries the preallocated user message identity once in presentation", () => {
    const payload = buildRequiredPayload({
      message: "hello",
      turnScopeId: "turn-1",
      userMessageId: "  msg_user-1  ",
    });

    expect(payload.presentation.userMessageId).toBe("msg_user-1");
    expect(payload).not.toHaveProperty("userMessageId");
  });

  it("keeps new Turn revision separate from the caller-owned session version", () => {
    const payload = buildRequiredPayload({
      message: "hello",
      turnScopeId: "turn-1",
      expectedAggregateVersion: 7,
    });

    expect(payload.concurrency.expectedTurnRevision).toBe(0);
    expect(payload.concurrency.expectedAggregateVersion).toBe(7);
  });

  it("carries connector selection only as initial state for a new Session", () => {
    const localPayload = buildRequiredPayload({
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
    const persistedPayload = buildRequiredPayload({
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
    const payload = buildRequiredPayload({
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

  it("leaves dialog identity of send and continue to service acceptance", () => {
    for (const options of [
      {},
      {
        continueFromStopped: true,
        resumeDialogProcessId: "dlg-stopped",
        resumeTurnScopeId: "turn-stopped",
      },
    ]) {
      const payload = buildRequiredPayload({
        activeSession: { value: { sessionId: "session-1" } },
        message: "hello",
        dialogProcessId: "dialog-client",
        turnScopeId: "turn-new",
        ...options,
      });
      expect(payload.identity.dialogProcessId).toBe("");
    }
  });

  it("builds independent continue payload with new turn and stopped snapshot identity", () => {
    const payload = buildRequiredPayload({
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
