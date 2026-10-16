/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  getMessageContentIdentity,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  getMessageTurnScopeIdKey,
  getMessageExplicitTurnIdentity,
  isSameMessageIdentity,
  isSameExplicitMessageTurn,
  normalizeTurnScopeIdKey,
} from "../../../../../src/modules/chat/model/messageIdentity.js";

describe("messageIdentity", () => {
  it("normalizes compatible message identity fields", () => {
    expect(getMessageTurnScopeId({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageDialogProcessId({ dialogId: " d1 " })).toBe("d1");
    expect(getMessageExplicitTurnIdentity({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageExplicitTurnIdentity({ dialogProcessId: " d1 " })).toBe("");
  });

  it("infers role and content from serialized LangChain messages", () => {
    const humanMessage = {
      lc_id: ["langchain_core", "messages", "human", "HumanMessage"],
      type: "constructor",
      kwargs: { content: "hello from human" },
    };
    const aiMessage = {
      lc_id: ["langchain_core", "messages", "ai", "AIMessage"],
      type: "constructor",
      lc_kwargs: { content: "hello from ai" },
    };

    expect(getMessageRole(humanMessage)).toBe("user");
    expect(getMessageContentIdentity(humanMessage)).toBe("hello from human");
    expect(getMessageRole(aiMessage)).toBe("assistant");
    expect(getMessageContentIdentity(aiMessage)).toBe("hello from ai");
  });

  it("treats frontend user markers as user messages when role is missing", () => {
    expect(
      getMessageRole({
        content: "original user prompt",
        additional_kwargs: { messageOrigin: "natural", userMetaMaterialized: true },
      }),
    ).toBe("user");
  });

  it("ignores removed authorRole/senderRole aliases", () => {
    expect(getMessageRole({ authorRole: "user" })).toBe("");
    expect(getMessageRole({ senderRole: "assistant" })).toBe("");
  });

  it("normalizes workflow-node turn scope keys for persisted/runtime matching", () => {
    expect(normalizeTurnScopeIdKey("workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1")).toBe(
      "workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1",
    );
    expect(
      getMessageTurnScopeId({ turnScopeId: "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1" }),
    ).toBe("workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1");
    expect(
      getMessageTurnScopeIdKey({ turnScopeId: "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1" }),
    ).toBe("workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1");
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
