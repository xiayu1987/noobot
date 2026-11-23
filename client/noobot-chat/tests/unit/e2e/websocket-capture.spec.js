/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createCapturedFrameLog,
  findAgentCommands,
} from "../../e2e/protocol/helpers/websocket-capture.js";

describe("protocol websocket capture", () => {
  it("ignores agent-transport debug summaries before deduplicating real commands", () => {
    const commandId = "command:interjection-1";
    const debugFrame = {
      url: "ws://localhost/api/logs/ws",
      payload: JSON.stringify({
        data: {
          debugType: "agent-transport",
          protocolVersion: 2,
          commandType: "turn.interject",
          commandId,
          sessionId: "session-1",
        },
      }),
    };
    const command = {
      protocolVersion: 2,
      commandType: "turn.interject",
      commandId,
      identity: {
        sessionId: "session-1",
        dialogProcessId: "dialog-1",
        turnScopeId: "turn-1",
      },
      interaction: { message: "constraint" },
    };
    const commandFrame = {
      url: "ws://localhost/api/agent-proxy/ws",
      payload: JSON.stringify(command),
    };

    expect(findAgentCommands([debugFrame, commandFrame])).toEqual([command]);
  });

  it("times out once and detaches the selector", async () => {
    vi.useFakeTimers();
    try {
      const frames = createCapturedFrameLog();
      const select = vi.fn(() => null);
      const failure = expect(frames.waitForMatch(select, 30)).rejects.toThrow(
        "Timed out waiting for captured protocol evidence",
      );
      frames.append({ payload: "unrelated" });
      await vi.advanceTimersByTimeAsync(30);
      await failure;
      frames.append({ payload: "late" });
      expect(select).toHaveBeenCalledOnce();
      expect(frames.records).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
