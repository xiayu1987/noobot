import { describe, expect, it } from "vitest";

import { injectTurnStatusPlaceholders } from "../../../../src/composables/chat/chatList/detailMessages";

const user = { role: "user", content: "hello", turnScopeId: "t1", dialogProcessId: "d1" };

function status(value, overrides = {}) {
  return {
    turnScopeId: "t1",
    dialogProcessId: "d1",
    status: value,
    reason: `reason_${value}`,
    description: `description_${value}`,
    ...overrides,
  };
}

describe("turn status placeholders", () => {
  it("does not create a placeholder for completed turns", () => {
    expect(injectTurnStatusPlaceholders([user], [status("completed")])).toEqual([user]);
  });

  it.each(["user_stopped", "error", "timeout"])("derives one placeholder for %s", (value) => {
    const result = injectTurnStatusPlaceholders([user], [status(value)]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      role: "assistant",
      synthetic: true,
      placeholder: true,
      turnStatusPlaceholder: true,
      status: value,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    });
  });

  it("matches either canonical identity", () => {
    const byTurn = injectTurnStatusPlaceholders(
      [{ role: "user", turnScopeId: "t1" }],
      [status("error", { dialogProcessId: "", turnScopeId: "t1" })],
    );
    const byDialog = injectTurnStatusPlaceholders(
      [{ role: "user", dialogProcessId: "d1" }],
      [status("error", { turnScopeId: "", dialogProcessId: "d1" })],
    );
    expect(byTurn).toHaveLength(2);
    expect(byDialog).toHaveLength(2);
  });

  it("keeps partial assistant content and remains idempotent", () => {
    const partial = { role: "assistant", content: "partial", turnScopeId: "t1", dialogProcessId: "d1" };
    const once = injectTurnStatusPlaceholders([user, partial], [status("user_stopped")]);
    expect(once).toHaveLength(3);
    expect(once[1].turnStatusPlaceholder).toBe(true);
    expect(once[2]).toBe(partial);
    const twice = injectTurnStatusPlaceholders(once, [status("user_stopped")]);
    expect(twice.filter((item) => item.turnStatusPlaceholder)).toHaveLength(1);
  });
});
