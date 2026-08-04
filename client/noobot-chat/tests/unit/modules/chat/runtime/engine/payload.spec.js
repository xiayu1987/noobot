/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildChatPayload } from "../../../../../../src/modules/chat/runtime/engine/payload.js";

describe("buildChatPayload model preferences", () => {
  it("disables text streaming by default", () => {
    expect(buildChatPayload({ message: "x" }).preferences.streaming).toBe(false);
  });

  it("enables output sanitization by default and sends an explicit opt-out", () => {
    expect(buildChatPayload({ message: "x" }).preferences.sanitizeOutput).toBe(true);
    expect(buildChatPayload({ message: "x", sanitizeOutput: false }).preferences.sanitizeOutput).toBe(false);
  });

  it("normalizes and sends the safety confirmation level", () => {
    expect(buildChatPayload({ message: "x", safeConfirmLevel: { value: "HIGH" } }).preferences.confirmationLevel).toBe("high");
    expect(buildChatPayload({ message: "x", safeConfirmLevel: "invalid" }).preferences.confirmationLevel).toBe("low");
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
      protocolVersion: 1,
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

  it("carries the caller-owned session revision in concurrency", () => {
    const payload = buildChatPayload({
      message: "hello",
      turnScopeId: "turn-1",
      expectedVersion: 0,
    });

    expect(payload.concurrency.expectedRevision).toBe(0);
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
      protocolVersion: 1,
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
