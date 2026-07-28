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
});
