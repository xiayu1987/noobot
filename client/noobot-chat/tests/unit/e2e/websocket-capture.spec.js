/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { findAgentCommands } from "../../e2e/protocol/helpers/websocket-capture.js";

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
});
