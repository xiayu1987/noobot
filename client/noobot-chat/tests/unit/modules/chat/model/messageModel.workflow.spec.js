/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage, foldConversationMessages } from "../../../../../src/modules/chat/model/messageModel.js";

describe("messageModel workflow messages", () => {
  it("infers workflow messages from canonical pluginMeta for card matching and folding", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "normal",
          dialogProcessId: "dp-workflow",
        },
        {
          role: "assistant",
          type: "workflow",
          content: "workflow plan",
          dialogProcessId: "dp-workflow",
          pluginMessage: true,
          pluginMeta: {
            source: "workflow-plugin",
            kind: "workflow",
            phase: "planning",
            payload: { semantic: { nodes: [{ id: "n1", type: "action" }] } },
          },
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].workflowMessage).toBe(true);
    expect(messages[1].workflowMeta?.source).toBe("workflow-plugin");
  });
});
