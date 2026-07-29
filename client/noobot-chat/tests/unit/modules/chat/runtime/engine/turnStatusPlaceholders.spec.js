/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { selectTurnPresentations } from "../../../../../../src/modules/chat/runtime/engine/turnPresentation.js";

const user = {
  id: "user-t1",
  sessionId: "session-1",
  role: "user",
  content: "hello",
  turnScopeId: "t1",
  dialogProcessId: "d1",
};
const assistant = {
  id: "assistant-t1",
  messageId: "assistant-t1",
  sessionId: "session-1",
  role: "assistant",
  content: "",
  turnScopeId: "t1",
  dialogProcessId: "d1",
  toolTimeline: [{ key: "tool-1" }],
};

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

function project(turnStatuses = [], messages = [user, assistant]) {
  return selectTurnPresentations({
    activeSession: { id: "session-1", messages, turnStatuses },
  });
}

describe("turn status presentations", () => {
  it("does not create a terminal presentation for completed turns", () => {
    expect(project([status("completed")])).toEqual([user, assistant]);
  });

  it.each(["user_stopped", "error", "timeout"])("derives one presentation for %s", (value) => {
    const result = project([status(value)]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "assistant-t1",
      messageId: "assistant-t1",
      role: "assistant",
      turnStatusPlaceholder: true,
      status: value,
      turnScopeId: "t1",
      dialogProcessId: "d1",
      toolTimeline: [{ key: "tool-1" }],
    });
    expect(result[1].content).toContain(`description_${value}`);
    expect(result[1].content).toContain(`原因：reason_${value}`);
  });

  it("keeps partial content and error details in the same assistant presentation", () => {
    const result = project(
      [status("error", {
        reason: "model_failed",
        description: "模型生成失败",
        error: { message: "upstream disconnected" },
      })],
      [user, { ...assistant, content: "partial answer" }],
    );

    expect(result).toHaveLength(2);
    expect(result[1].content).toBe(
      "partial answer\n\n本轮异常停止\n模型生成失败\n原因：model_failed\n异常：upstream disconnected",
    );
  });

  it("creates one stable presentation when the canonical assistant is absent", () => {
    const once = project([status("user_stopped")], [user]);
    const twice = selectTurnPresentations({
      activeSession: {
        id: "session-1",
        messages: [user],
        turnStatuses: [status("user_stopped")],
      },
    });

    expect(once).toHaveLength(2);
    expect(once[1].id).toBe("turn-status-placeholder:t1");
    expect(twice).toEqual(once);
  });

  it("does not project a terminal status onto another Turn", () => {
    const result = project([
      status("error", { turnScopeId: "other-turn", dialogProcessId: "other-dialog" }),
    ]);

    expect(result).toHaveLength(3);
    expect(result[1]).toBe(assistant);
    expect(result[2]).toMatchObject({ turnScopeId: "other-turn", status: "error" });
  });
});
