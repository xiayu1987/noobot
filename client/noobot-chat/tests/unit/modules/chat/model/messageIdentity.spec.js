/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  areTurnScopeIdsEquivalent,
  getMessageContentIdentity,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  getMessageExplicitTurnIdentity,
  isSameMessageIdentity,
  isSameExplicitMessageTurn,
} from "../../../../../src/modules/chat/model/messageIdentity.js";

describe("messageIdentity", () => {
  it("reads top-level message identity fields only", () => {
    expect(getMessageTurnScopeId({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageDialogProcessId({ dialogProcessId: "d1" })).toBe("d1");
    expect(getMessageDialogProcessId({ dialogId: "d1" })).toBe("");
    expect(getMessageExplicitTurnIdentity({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageExplicitTurnIdentity({ dialogProcessId: " d1 " })).toBe("");
  });

  it("ignores removed authorRole/senderRole/messageRole aliases", () => {
    expect(getMessageRole({ authorRole: "user" })).toBe("");
    expect(getMessageRole({ senderRole: "assistant" })).toBe("");
    expect(getMessageRole({ messageRole: "assistant" })).toBe("");
    expect(getMessageRole({ messageOrigin: "natural" })).toBe("");
    expect(getMessageRole({ lc_id: ["langchain_core", "messages", "human", "HumanMessage"] })).toBe(
      "",
    );
    expect(getMessageContentIdentity({ lc_kwargs: { content: "x" } })).toBe("");
  });

  it("keys workflow-node turn scopes by their single canonical encoding", () => {
    expect(
      getMessageTurnScopeId({ turnScopeId: "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1" }),
    ).toBe("workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1");
    expect(
      areTurnScopeIdsEquivalent(
        "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1",
        "workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1",
      ),
    ).toBe(false);
  });

  it("does not treat user and assistant in the same turn scope as the same message", () => {
    expect(
      isSameMessageIdentity(
        { role: "assistant", turnScopeId: "client-turn:1", content: "answer" },
        { role: "user", turnScopeId: "client-turn:1", content: "question" },
      ),
    ).toBe(false);
    expect(
      isSameMessageIdentity(
        { role: "assistant", turnScopeId: "client-turn:1", content: "answer" },
        { role: "assistant", turnScopeId: "client-turn:1", content: "streaming answer" },
      ),
    ).toBe(true);
  });

  it("matches explicit assistant scopes without falling back to dialog id", () => {
    expect(
      isSameExplicitMessageTurn(
        { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
        { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
      ),
    ).toBe(true);
    expect(
      isSameExplicitMessageTurn(
        { role: "assistant", dialogProcessId: "dp-1" },
        { role: "assistant", dialogProcessId: "dp-1" },
      ),
    ).toBe(false);
  });
});
