import { describe, expect, it } from "vitest";
import {
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  getMessageExplicitTurnIdentity,
  isSameExplicitMessageTurn,
  isSameMessageRound,
  shouldCollectAttachmentMetasFromMessage,
} from "../../../../src/composables/infra/messageIdentity";

describe("messageIdentity", () => {
  it("normalizes compatible message identity fields", () => {
    expect(getMessageTurnScopeId({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageDialogProcessId({ dialogId: " d1 " })).toBe("d1");
    expect(getMessageExplicitTurnIdentity({ turnScopeId: " c1 " })).toBe("c1");
    expect(getMessageExplicitTurnIdentity({ dialogProcessId: " d1 " })).toBe("");
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
    expect(shouldCollectAttachmentMetasFromMessage(
      { role: "assistant", dialogProcessId: "dp-1" },
      { role: "assistant", dialogProcessId: "dp-1" },
    )).toBe(false);
    expect(shouldCollectAttachmentMetasFromMessage(
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
      { role: "assistant", dialogProcessId: "dp-1", turnScopeId: "client-1" },
    )).toBe(true);
    expect(shouldCollectAttachmentMetasFromMessage(
      { role: "assistant", dialogProcessId: "dp-1" },
      { role: "tool", dialogProcessId: "dp-1" },
    )).toBe(true);
  });
});
