/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { injectTurnStatusPlaceholders } from "../../../../../../src/modules/session/model/list/detailMessages.js";

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
    expect(result[1].content).toContain(`description_${value}`);
    expect(result[1].content).toContain(`原因：reason_${value}`);
  });

  it("derives the stopped presentation from turn status when the canonical assistant is empty", () => {
    const emptyAssistant = {
      role: "assistant",
      content: null,
      pending: false,
      turnScopeId: "t1",
      dialogProcessId: "d1",
      toolTimeline: [{ key: "tool-1" }],
      activityTimeline: [{ eventId: "activity-1" }],
    };
    const result = injectTurnStatusPlaceholders(
      [user, emptyAssistant],
      [status("user_stopped", { reason: "user_stop", description: "用户停止了本轮生成" })],
    );

    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({
      id: "turn-status-placeholder:t1",
      turnStatusPlaceholder: true,
      content: "本轮已由用户停止\n用户停止了本轮生成\n原因：user_stop",
    });
    expect(result[2]).toBe(emptyAssistant);
  });

  it("keeps the terminal reason visible alongside persisted assistant content", () => {
    const assistant = {
      role: "assistant",
      content: "partial answer",
      pending: false,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    };
    const result = injectTurnStatusPlaceholders([user, assistant], [status("error", {
      reason: "model_failed",
      description: "模型生成失败",
      error: { message: "upstream disconnected" },
    })]);

    expect(result).toHaveLength(3);
    expect(result[1].content).toBe(
      "本轮异常停止\n模型生成失败\n原因：model_failed\n异常：upstream disconnected",
    );
    expect(result[2]).toBe(assistant);
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

  it("moves an existing placeholder below its owning user message", () => {
    const placeholder = injectTurnStatusPlaceholders([user], [status("user_stopped")])[1];
    const result = injectTurnStatusPlaceholders([placeholder, user], [status("user_stopped")]);
    expect(result).toEqual([user, placeholder]);
  });
});
