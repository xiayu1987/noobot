/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { mergeCanonicalSessionDetail } from "../../../../../src/modules/chat/model/sessionDetailMerge.js";

describe("mergeCanonicalSessionDetail", () => {
  it("preserves content for a partial update without mutating either input", () => {
    const message = Object.freeze({ messageUid: "u1", role: "user", content: "question" });
    const base = Object.freeze({ sessionId: "session-1", messages: Object.freeze([message]) });
    const incoming = Object.freeze({ sessionId: "session-1", title: "updated" });
    const merged = mergeCanonicalSessionDetail(base, incoming);
    expect(merged).toMatchObject({ title: "updated", messages: [message] });
    expect(incoming).not.toHaveProperty("messages");
    expect(base.messages[0]).toBe(message);
    expect(mergeCanonicalSessionDetail({}, incoming).messages).toEqual([]);
  });

  it.each([null, undefined, [], "bad", false])(
    "rejects invalid content %j on either side",
    (value) => {
      expect(() => mergeCanonicalSessionDetail(value, {})).toThrow(/content projection/);
      expect(() => mergeCanonicalSessionDetail({}, value)).toThrow(/content projection/);
    },
  );

  it.each([null, undefined, {}, "bad", [null], [[]], ["bad"]])(
    "rejects explicit malformed messages %j on merge and replacement",
    (messages) => {
      for (const replaceFields of [[], ["messages"]]) {
        expect(() => mergeCanonicalSessionDetail({}, { messages }, { replaceFields })).toThrow(
          /content projection messages/,
        );
        expect(() => mergeCanonicalSessionDetail({ messages }, {}, { replaceFields })).toThrow(
          /content projection messages/,
        );
      }
    },
  );

  it("rejects retired top-level fields on either side instead of dropping them", () => {
    for (const field of ["sessionSummary", "turnTimings"]) {
      expect(() => mergeCanonicalSessionDetail({ [field]: undefined }, {})).toThrow(
        new RegExp(`carries ${field}`),
      );
      expect(() => mergeCanonicalSessionDetail({}, { [field]: undefined })).toThrow(
        new RegExp(`carries ${field}`),
      );
    }
  });

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
      toolTimeline: [{ key: "call:tool-1", toolCallId: "tool-1", status: "running" }],
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
    expect(merged.messages[0].toolTimeline).toEqual(realtime.toolTimeline);
  });

  it("does not regress a persisted assistant terminal fact when a realtime shell arrives later", () => {
    const thinking = {
      eventId: "thinking-1",
      eventType: "thinking",
      activityId: "activity-1",
      activityKind: "main_model_analysis",
      text: "thinking",
      sequence: 1,
      sequenceScopeId: "session-1",
      sequenceDomain: "message-event",
      authority: "authoritative",
      timestamp: "2026-10-31T17:00:00.000Z",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
    };
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
      activityTimeline: [thinking],
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
    expect(merged.messages[0].activityTimeline).toEqual([thinking]);

    const newerThinking = { ...thinking, eventId: "thinking-2", sequence: 2, text: "complete" };
    const newer = mergeCanonicalSessionDetail(merged, {
      sessionId: "session-1",
      messages: [{ ...realtime, activityTimeline: [newerThinking] }],
    });
    const replayed = mergeCanonicalSessionDetail(newer, {
      sessionId: "session-1",
      messages: [realtime],
    });
    expect(newer.messages[0].activityTimeline).toEqual([newerThinking]);
    expect(replayed.messages[0].activityTimeline).toEqual([newerThinking]);
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
      toolTimeline: [{ key: "call:tool-2", toolCallId: "tool-2", status: "running" }],
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
    expect(merged.messages[0].toolTimeline).toEqual(realtime.toolTimeline);
  });

  it.each([[], ["messages"]])("rejects retired rawEvents when replacing %j", (replaceFields) => {
    const detail = {
      sessionId: "session-1",
      messages: [{ presentationMessageId: "p1", role: "assistant", rawEvents: [] }],
    };
    expect(() => mergeCanonicalSessionDetail({}, detail, { replaceFields })).toThrow(
      /rawEvents is retired/,
    );
    expect(() => mergeCanonicalSessionDetail(detail, {})).toThrow(/rawEvents is retired/);
  });

  it.each([
    ["toolTimeline", { eventId: "event-only" }, /requires key call:<toolCallId>/],
    ["toolTimeline", { key: "call:wrong", toolCallId: "call-1" }, /requires key call:<toolCallId>/],
    ["activityTimeline", { eventId: "event-only", text: "thinking" }, /noncanonical fact/],
  ])("rejects invalid %s identity instead of inventing a merge key", (field, fact, error) => {
    const incoming = {
      sessionId: "session-1",
      messages: [{ presentationMessageId: "p1", role: "assistant", [field]: [fact] }],
    };
    expect(() => mergeCanonicalSessionDetail({}, incoming)).toThrow(error);
  });

  it("merges tool call and result facets by the canonical call identity", () => {
    const call = {
      key: "call:call-1",
      toolCallId: "call-1",
      call: { eventId: "start", sequence: 1 },
    };
    const result = {
      key: "call:call-1",
      toolCallId: "call-1",
      success: true,
      resultEvent: { eventId: "end", sequence: 2 },
    };
    const detail = (entry) => ({
      sessionId: "session-1",
      messages: [{ presentationMessageId: "p1", role: "assistant", toolTimeline: [entry] }],
    });
    const merged = mergeCanonicalSessionDetail(detail(call), detail(result));
    expect(merged.messages[0].toolTimeline).toEqual([{ ...call, ...result, status: "completed" }]);
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
