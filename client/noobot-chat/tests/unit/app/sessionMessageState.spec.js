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
} from "../../../src/app/state/sessionMessageState.js";

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
    expect(item.type).toBe("tool_result");
    expect(item.category).toBe("tool");
    expect(item.text).toContain("[tool] done");
    expect(item.dialogProcessId).toBe("123");
    expect(item.subAgentCall).toBe(true);
    expect(item.subAgentSessionId).toBe(" child ");
    expect(item.ts).toEqual(expect.any(String));
  });

  it("uses authoritative tool lifecycle types for realtime call and result records", () => {
    const common = {
      event: "thinking",
      type: "tool_call",
      tool: "read_file",
      toolCallId: "call-1",
    };
    const call = classifyRealtimeLog({
      ...common,
      eventType: "tool_call_start",
      args: { filePath: "a.txt" },
    });
    const result = classifyRealtimeLog({
      ...common,
      eventType: "tool_call_end",
      result: { ok: true },
    });

    expect(call).toMatchObject({ event: "tool_call", type: "tool_call" });
    expect(result).toMatchObject({ event: "tool_result", type: "tool_result" });
    expect(call.text).toContain("[tool] read_file call");
    expect(call.text).toContain('"filePath":"a.txt"');
    expect(result.text).toContain("[tool] read_file result");
    expect(result.text).toContain('"ok":true');
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

  it("allows reconnect only after a backend session identity exists", () => {
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: "" })).toBe(false);
    expect(hasActiveSessionForReconnect({ activeSession: { backendSessionId: " backend " }, activeSessionId: "" })).toBe(true);
    expect(hasActiveSessionForReconnect({ activeSession: { id: " local ", isLocal: true }, activeSessionId: "local" })).toBe(false);
    expect(hasActiveSessionForReconnect({ activeSession: {}, activeSessionId: " active " })).toBe(false);
  });
});
