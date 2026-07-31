/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { mergeCanonicalSessionDetail } from "../../../../../src/modules/chat/model/sessionDetailMerge.js";

describe("mergeCanonicalSessionDetail", () => {
  it("keeps persisted facts when a sparse realtime update arrives later", () => {
    const persisted = {
      sessionId: "session-1",
      messages: [
        { id: "u1", role: "user", content: "question", turnScopeId: "turn-1" },
        { id: "a1", role: "assistant", content: "partial", turnScopeId: "turn-1" },
      ],
      turnStatuses: [{ turnScopeId: "turn-1", status: "completed" }],
      turnTimings: [{ turnScopeId: "turn-1", thinkingStartedAt: "start", thinkingFinishedAt: "end" }],
    };

    const merged = mergeCanonicalSessionDetail(persisted, {
      sessionId: "session-1",
      messages: [{ id: "a1", role: "assistant", content: "final", turnScopeId: "turn-1" }],
    });

    expect(merged.messages).toHaveLength(2);
    expect(merged.messages.find((item) => item.id === "u1")?.content).toBe("question");
    expect(merged.messages.find((item) => item.id === "a1")?.content).toBe("final");
    expect(merged.turnStatuses[0].status).toBe("completed");
    expect(merged.turnTimings[0].thinkingFinishedAt).toBe("end");
  });

  it("does not roll a terminal turn back or mix different sessions", () => {
    const terminal = mergeCanonicalSessionDetail(
      { sessionId: "session-1", turnStatuses: [{ turnScopeId: "turn-1", status: "completed", result: "ok" }] },
      { sessionId: "session-1", turnStatuses: [{ turnScopeId: "turn-1", status: "thinking", progress: 50 }] },
    );
    expect(terminal.turnStatuses[0]).toMatchObject({ status: "completed", result: "ok", progress: 50 });

    const isolated = mergeCanonicalSessionDetail(terminal, {
      sessionId: "session-2",
      messages: [{ id: "u2", role: "user", content: "new" }],
    });
    expect(isolated.sessionId).toBe("session-2");
    expect(isolated.messages.map((item) => item.id)).toEqual(["u2"]);
    expect(isolated.turnStatuses).toEqual([]);
  });

  it("only deletes facts through explicit replacement", () => {
    const base = {
      sessionId: "session-1",
      messages: [{ id: "u1", role: "user", content: "old" }],
      turnStatuses: [{ turnScopeId: "turn-1", status: "completed" }],
    };
    const sparse = mergeCanonicalSessionDetail(base, { sessionId: "session-1", messages: [] });
    expect(sparse.messages).toHaveLength(1);

    const replaced = mergeCanonicalSessionDetail(base, { sessionId: "session-1", messages: [] }, {
      replaceFields: ["messages"],
    });
    expect(replaced.messages).toEqual([]);
    expect(replaced.turnStatuses).toHaveLength(1);
  });

  it("merges assistant records by presentation identity without duplicating final content", () => {
    const realtime = {
      id: "presentation-1",
      messageId: "presentation-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      content: "final answer",
      pending: true,
      turnScopeId: "turn-1",
      toolTimeline: [{ eventId: "tool-1" }],
    };
    const persisted = {
      id: "source-1",
      messageId: "source-1",
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      type: "message",
      content: "final answer",
      pending: false,
      turnScopeId: "turn-1",
    };

    const merged = mergeCanonicalSessionDetail(
      { sessionId: "session-1", messages: [realtime] },
      { sessionId: "session-1", messages: [persisted] },
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      id: "source-1",
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      content: "final answer",
      pending: false,
    });
    expect(merged.messages[0].toolTimeline).toEqual([{ eventId: "tool-1" }]);
  });

  it("does not regress a persisted assistant terminal fact when a realtime shell arrives later", () => {
    const persisted = {
      id: "source-1",
      messageId: "source-1",
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      type: "message",
      content: "final answer",
      pending: false,
      turnScopeId: "turn-1",
    };
    const realtime = {
      id: "presentation-1",
      messageId: "presentation-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      content: "",
      pending: true,
      turnScopeId: "turn-1",
      activityTimeline: [{ eventId: "thinking-1", text: "thinking" }],
    };

    const merged = mergeCanonicalSessionDetail(
      { sessionId: "session-1", messages: [persisted] },
      { sessionId: "session-1", messages: [realtime] },
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      id: "source-1",
      messageUid: "uid-1",
      content: "final answer",
      pending: false,
    });
    expect(merged.messages[0].activityTimeline).toEqual([
      { eventId: "thinking-1", text: "thinking" },
    ]);
  });
});
