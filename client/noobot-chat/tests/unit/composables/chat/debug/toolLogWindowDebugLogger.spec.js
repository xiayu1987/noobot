/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logToolLogWindowDebug,
  setToolLogWindowDebugLogSink,
  summarizeToolLogWindowItem,
} from "../../../../../src/composables/chat/debug/toolLogWindowDebugLogger.js";

describe("toolLogWindowDebugLogger", () => {
  afterEach(() => setToolLogWindowDebugLogSink(null));

  it("routes a bounded structured record to its dedicated debug type", () => {
    const log = vi.fn();
    setToolLogWindowDebugLogSink({ log });

    logToolLogWindowDebug("frontend.toolLogWindow.rendererReceived", {
      sessionId: "session-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      selectedCount: 10,
    });

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      category: "debug",
      level: "debug",
      debugType: "tool-log-window",
      sessionId: "session-1",
      data: expect.objectContaining({
        debugType: "tool-log-window",
        selectedCount: 10,
      }),
    }));
  });

  it("caps content previews without losing ordering identity", () => {
    const summary = summarizeToolLogWindowItem({
      event: "tool_call_error",
      sequence: 7,
      toolCallId: "call-7",
      text: "x".repeat(800),
    });

    expect(summary).toMatchObject({
      event: "tool_call_error",
      sequence: 7,
      toolCallId: "call-7",
      textLength: 800,
    });
    expect(summary.textPreview).toHaveLength(500);
  });
});
