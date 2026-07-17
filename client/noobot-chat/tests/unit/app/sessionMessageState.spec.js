/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  classifyRealtimeLog,
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect,
  isImageMime,
} from "../../../src/app/state/sessionMessageState";

describe("sessionMessageState", () => {
  it("classifies realtime tool logs while normalizing event, text, ids, and timestamps", () => {
    const item = classifyRealtimeLog({
      event: "tool_result",
      text: "\u001b[31m[tool] done\u001b[0m",
      dialogProcessId: 123,
      subAgentCall: 1,
      subAgentSessionId: " child ",
    });

    expect(item.event).toBe("tool_result");
    expect(item.type).toBe("tool_call");
    expect(item.category).toBe("tool");
    expect(item.text).toContain("[tool] done");
    expect(item.dialogProcessId).toBe("123");
    expect(item.subAgentCall).toBe(true);
    expect(item.subAgentSessionId).toBe(" child ");
    expect(item.ts).toEqual(expect.any(String));
  });

  it("classifies regular realtime logs as system defaults", () => {
    const item = classifyRealtimeLog({ text: "hello" });

    expect(item.event).toBe("system");
    expect(item.type).toBe("system");
    expect(item.category).toBe("system");
    expect(item.subAgentLabel).toBe("");
    expect(item.subAgentTask).toBe("");
  });

  it("preserves plugin analysis text from output fallback fields", () => {
    const topLevelOutput = classifyRealtimeLog({
      event: "guidance_analysis_response",
      type: "guidance_analysis",
      purpose: "guidance",
      pluginFlow: "analysis",
      chain: "auxiliary",
      output: "desktop analysis output",
    });
    const nestedOutput = classifyRealtimeLog({
      event: "guidance_analysis_response",
      data: { output: "nested desktop analysis output" },
    });

    expect(topLevelOutput.text).toBe("desktop analysis output");
    expect(nestedOutput.text).toBe("nested desktop analysis output");
  });

  it("formats message attachment and time helpers", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("text/plain")).toBe(false);
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatTime("2026-06-18T09:08:00.000Z")).toMatch(/\d{1,2}:\d{2}/);
  });

  it("detects whether there is an active session candidate for reconnect", () => {
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: "" })).toBe(false);
    expect(hasActiveSessionForReconnect({ activeSession: { backendSessionId: " backend " }, activeSessionId: "" })).toBe(true);
    expect(hasActiveSessionForReconnect({ activeSession: { id: " local " }, activeSessionId: "" })).toBe(true);
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: " active " })).toBe(true);
  });
});
