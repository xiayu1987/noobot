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
        { messageUid: "u1", role: "user", content: "question", turnScopeId: "turn-1" },
        {
          messageUid: "a1",
          presentationMessageId: "a1",
          role: "assistant",
          content: "partial",
          turnScopeId: "turn-1",
        },
      ],
    };

    const merged = mergeCanonicalSessionDetail(persisted, {
      sessionId: "session-1",
      messages: [
        {
          messageUid: "a1",
          presentationMessageId: "a1",
          role: "assistant",
          content: "final",
          turnScopeId: "turn-1",
        },
      ],
    });

    expect(merged.messages).toHaveLength(2);
    expect(merged.messages.find((item) => item.messageUid === "u1")?.content).toBe("question");
    expect(merged.messages.find((item) => item.messageUid === "a1")?.content).toBe("final");
    expect(merged).not.toHaveProperty("turnTimings");
  });

  it("rejects turn timings carried through the session detail", () => {
    expect(() =>
      mergeCanonicalSessionDetail(
        { sessionId: "session-1", messages: [] },
        { sessionId: "session-1", messages: [], turnTimings: [] },
      ),
    ).toThrow(/carries turnTimings/);
  });

  it("rejects a message without view identity on both merge and replace", () => {
    const anonymous = { role: "assistant", content: "no identity" };
    expect(() =>
      mergeCanonicalSessionDetail(
        { sessionId: "session-1", messages: [] },
        { sessionId: "session-1", messages: [anonymous] },
      ),
    ).toThrow(/message without view identity: role=assistant/);
    expect(() =>
      mergeCanonicalSessionDetail(
        { sessionId: "session-1", messages: [] },
        { sessionId: "session-1", messages: [anonymous] },
        { replaceFields: ["messages"] },
      ),
    ).toThrow(/message without view identity/);
  });

  it("does not mix different sessions", () => {
    const isolated = mergeCanonicalSessionDetail(
      { sessionId: "session-1" },
      {
        sessionId: "session-2",
        messages: [{ messageUid: "u2", role: "user", content: "new" }],
      },
    );
    expect(isolated.sessionId).toBe("session-2");
    expect(isolated.messages.map((item) => item.messageUid)).toEqual(["u2"]);
  });

  it("only deletes facts through explicit replacement", () => {
    const base = {
      sessionId: "session-1",
      messages: [{ messageUid: "u1", role: "user", content: "old" }],
    };
    const sparse = mergeCanonicalSessionDetail(base, { sessionId: "session-1", messages: [] });
    expect(sparse.messages).toHaveLength(1);

    const replaced = mergeCanonicalSessionDetail(
      base,
      { sessionId: "session-1", messages: [] },
      {
        replaceFields: ["messages"],
      },
    );
    expect(replaced.messages).toEqual([]);
  });

  it("merges assistant records by presentation identity without duplicating final content", () => {
    const realtime = {
      presentationMessageId: "presentation-1",
      role: "assistant",
      content: "final answer",
      pending: true,
      turnScopeId: "turn-1",
      toolTimeline: [{ eventId: "tool-1" }],
    };
    const persisted = {
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      type: "message",
      content: "final answer",
      turnScopeId: "turn-1",
    };

    const merged = mergeCanonicalSessionDetail(
      { sessionId: "session-1", messages: [realtime] },
      { sessionId: "session-1", messages: [persisted] },
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      content: "final answer",
    });
    expect(merged.messages[0]).not.toHaveProperty("pending");
    expect(merged.messages[0].toolTimeline).toEqual([{ eventId: "tool-1" }]);
  });

  it("does not regress a persisted assistant terminal fact when a realtime shell arrives later", () => {
    const persisted = {
      messageUid: "uid-1",
      presentationMessageId: "presentation-1",
      role: "assistant",
      type: "message",
      content: "final answer",
      turnScopeId: "turn-1",
    };
    const realtime = {
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
      messageUid: "uid-1",
      content: "final answer",
    });
    expect(merged.messages[0]).not.toHaveProperty("pending");
    expect(merged.messages[0].activityTimeline).toEqual([
      { eventId: "thinking-1", text: "thinking" },
    ]);
  });

  it("uses presentation identity when a persisted terminal assistant has no messageUid", () => {
    const persisted = {
      presentationMessageId: "presentation-2",
      role: "assistant",
      type: "message",
      content: "completed child result",
      turnScopeId: "workflow-node:node-2",
    };
    const realtime = {
      presentationMessageId: "presentation-2",
      role: "assistant",
      content: "",
      pending: true,
      turnScopeId: "workflow-node:node-2",
      toolTimeline: [{ eventId: "tool-2" }],
    };

    const merged = mergeCanonicalSessionDetail(
      { sessionId: "child-session", messages: [persisted] },
      { sessionId: "child-session", messages: [realtime] },
    );

    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).toMatchObject({
      presentationMessageId: "presentation-2",
      content: "completed child result",
    });
    expect(merged.messages[0]).not.toHaveProperty("pending");
    expect(merged.messages[0].toolTimeline).toEqual([{ eventId: "tool-2" }]);
  });

  it("does not treat the removed messageRole alias as assistant role for presentation merge", () => {
    const message = (messageUid) => ({
      messageUid,
      messageRole: "assistant",
      presentationMessageId: "presentation-alias",
      type: "message",
      content: messageUid,
    });
    const merged = mergeCanonicalSessionDetail(
      { sessionId: "session-1", messages: [message("a1")] },
      { sessionId: "session-1", messages: [message("a2")] },
    );
    expect(merged.messages.map((item) => item.messageUid)).toEqual(["a1", "a2"]);
  });
});
