import { describe, expect, it } from "vitest";
import {
  getMessageContentIdentity,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  getMessageExplicitTurnIdentity,
  isSameMessageIdentity,
  isSameExplicitMessageTurn,
  isSameMessageRound,
  shouldCollectAttachmentsFromMessage,
} from "../../../../src/composables/infra/messageIdentity";

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
    expect(getMessageRole({
      content: "original user prompt",
      additional_kwargs: { frontendUserMessage: true },
    })).toBe("user");
  });

  it("matches same message round by turn scope before dialog id", () => {
    expect(isSameMessageRound(
      { turnScopeId: "client-1", dialogProcessId: "dp-1" },
      { turnScopeId: "client-1", dialogProcessId: "dp-2" },
    )).toBe(true);
    expect(isSameMessageRound(
      { turnScopeId: "client-1", dialogProcessId: "dp-1" },
      { turnScopeId: "client-2", dialogProcessId: "dp-1" },
    )).toBe(false);
  });

  it("does not treat user and assistant in the same turn scope as the same message", () => {
    expect(isSameMessageIdentity(
      { role: "assistant", turnScopeId: "client-turn:1", content: "answer" },
      { role: "user", turnScopeId: "client-turn:1", content: "question" },
    )).toBe(false);
    expect(isSameMessageIdentity(
      { role: "assistant", turnScopeId: "client-turn:1", content: "answer" },
      { role: "assistant", turnScopeId: "client-turn:1", content: "streaming answer" },
    )).toBe(true);
  });

  it("matches explicit assistant scopes without falling back to dialog id", () => {
    expect(isSameExplicitMessageTurn(
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
    )).toBe(true);
    expect(isSameExplicitMessageTurn(
      { role: "assistant", dialogProcessId: "dp-1" },
      { role: "assistant", dialogProcessId: "dp-1" },
    )).toBe(false);
  });

  it("blocks assistant attachment collection when explicit turn identity is missing", () => {
    expect(shouldCollectAttachmentsFromMessage(
      { role: "assistant", dialogProcessId: "dp-1" },
      { role: "assistant", dialogProcessId: "dp-1" },
    )).toBe(false);
    expect(shouldCollectAttachmentsFromMessage(
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
    )).toBe(true);
    expect(shouldCollectAttachmentsFromMessage(
      { role: "assistant", dialogProcessId: "dp-1" },
      { role: "tool", dialogProcessId: "dp-1" },
    )).toBe(true);
  });
});
