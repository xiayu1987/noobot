import { describe, expect, it } from "vitest";
import { matchesMessageStatusRow } from "../../../../../plugin/noobot-plugin-harness/frontend/index.js";

describe("harness message status renderer", () => {
  it("matches a refreshed assistant message with only persisted status", () => {
    expect(matchesMessageStatusRow({
      role: "assistant",
      persistedStatusStepState: "completed",
    })).toBe(true);
  });

  it("matches a refreshed assistant message with projected status identity", () => {
    expect(matchesMessageStatusRow({
      role: "assistant",
      statusTurnScopeId: "client-turn:test",
    })).toBe(true);
  });

  it("does not match unrelated or user messages", () => {
    expect(matchesMessageStatusRow({ role: "assistant" })).toBe(false);
    expect(matchesMessageStatusRow({
      role: "user",
      persistedStatusStepState: "completed",
    })).toBe(false);
  });
});
