/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildChatPayload } from "../../../../src/composables/chat/chatEngine/payload";

describe("buildChatPayload model preferences", () => {
  it("enables output sanitization by default and sends an explicit opt-out", () => {
    expect(buildChatPayload({ message: "x" }).config.sanitizeOutput).toBe(true);
    expect(buildChatPayload({ message: "x", sanitizeOutput: false }).config.sanitizeOutput).toBe(false);
  });

  it("normalizes and sends the safety confirmation level", () => {
    expect(buildChatPayload({ message: "x", safeConfirmLevel: { value: "HIGH" } }).config.safeConfirmLevel).toBe("high");
    expect(buildChatPayload({ message: "x", safeConfirmLevel: "invalid" }).config.safeConfirmLevel).toBe("low");
  });
  it("writes selectedModel and current scenario pluginModelConfig to config payload", () => {
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

    expect(payload.config).toMatchObject({
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
    });
  });

  it("accepts selectedPlugins as a plain array", () => {
    const payload = buildChatPayload({
      userId: "admin",
      message: "hello",
      selectedPlugins: [" harness ", "workflow", ""],
    });

    expect(payload.config.selectedPlugins).toEqual(["harness", "workflow"]);
  });

  it("builds independent continue payload with new turn and stopped snapshot identity", () => {
    const payload = buildChatPayload({
      userId: "admin",
      activeSession: { value: { sessionId: "s1" } },
      message: "continue question",
      action: "continue",
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
      action: "continue",
      userId: "admin",
      sessionId: "s1",
      turnScopeId: "turn-resume-new",
      message: "continue question",
      attachments: [{ attachmentId: "att-1", name: "a.txt" }],
    });
    expect(payload.config).toMatchObject({
      streaming: false,
      scenario: "programming",
      selectedModel: "main-model",
      resumeDialogProcessId: "dlg-stopped",
      resumeTurnScopeId: "turn-stopped",
      stoppedTurnScopeId: "turn-stopped",
    });
    expect(payload.dialogProcessId).toBeUndefined();
    expect(payload.config.reuseExistingUserTurn).toBeUndefined();
  });
});
