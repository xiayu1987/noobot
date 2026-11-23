/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionDisplayRowOrderKey } from "@noobot/session-protocol/session-reader";
import { buildSessionDisplayEntries } from "../../src/session/session-summary-builders/display-message-list.js";
import { countSessionDisplaySources } from "../../src/session/session-summary-builders/display-summary-stats.js";
import { buildSessionDisplayRowsAndStats } from "../../src/session/session-summary-builders/session-display-summary.js";
import { turnRecord } from "../helpers/turn-record.js";

const buildSessionDisplayMessages = (input) =>
  buildSessionDisplayEntries(input).map(({ row }) => row);

test("display anchors lifecycle placeholders after the last owning user", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const lifecycle = {
    turns: Object.fromEntries(
      ids.map((id, index) => [
        id,
        turnRecord({ turnScopeId: id, sequence: index + 1, state: "stop_completed" }),
      ]),
    ),
  };
  const user = (turnScopeId, content) => ({
    role: "user",
    type: "message",
    sessionId: "display-session",
    messageUid: `sm-${content}`,
    attachments: [],
    turnScopeId,
    content,
  });
  const assistant = {
    role: "assistant",
    type: "message",
    sessionId: "display-session",
    messageUid: "sm-answer",
    modelMessageId: "mm-display-answer",
    attachments: [],
    presentationMessageId: "message-b",
    turnScopeId: "b",
    content: "answer",
  };
  const messages = [
    user("a", "first"),
    user("b", "second"),
    user("a", "last"),
    assistant,
    user("e", "end"),
  ];
  const display = buildSessionDisplayMessages({ messages, lifecycle });
  assert.deepEqual(
    display.map((item) => (item.turnPlaceholder ? item.presentationMessageId : item.content)),
    [
      "first",
      "second",
      "last",
      "message-a",
      "answer",
      "end",
      "message-e",
      "message-c",
      "message-d",
    ],
  );
  assert.throws(
    () =>
      buildSessionDisplayMessages({ messages: [{ ...assistant, turnScopeId: "a" }], lifecycle }),
    /presentation_turn_scope_conflict/,
  );
});

test("display ordering does not mix assistant identities with user row positions", () => {
  const user = {
    role: "user",
    type: "message",
    sessionId: "display-session",
    messageUid: "sm-user",
    turnScopeId: "a",
    content: "question",
    attachments: [],
  };
  const assistant = {
    ...user,
    role: "assistant",
    messageUid: "sm-answer",
    modelMessageId: "mm-answer",
    presentationMessageId: "user:0",
    content: "answer",
  };
  const messages = [user, assistant];
  const lifecycle = { turns: {} };
  const ordered = buildSessionDisplayMessages({ messages, lifecycle });
  assert.deepEqual(
    ordered.map(({ messageUid }) => messageUid),
    ["sm-user", "sm-answer"],
  );
});

test("stored display rows keep the winning message ordinal at the first presentation position", () => {
  const canonical = {
    role: "assistant",
    type: "message",
    sessionId: "display-session",
    turnScopeId: "a",
    messageUid: "sm-canonical",
    modelMessageId: "mm-canonical",
    presentationMessageId: "presentation-a",
    content: "canonical answer",
    chatPresentation: true,
    attachments: [],
  };
  const other = {
    role: "user",
    type: "message",
    sessionId: "display-session",
    turnScopeId: "b",
    messageUid: "sm-other",
    content: "question from another turn",
    attachments: [],
  };
  const messages = [canonical, other];
  const lifecycle = { turns: {} };
  const ordinals = new Map([
    [canonical.messageUid, 4],
    [other.messageUid, 2],
  ]);
  const options = { messages, lifecycle };
  const selectSourceOrdinal = ({ messageUid }) => ordinals.get(messageUid);
  assert.deepEqual(
    buildSessionDisplayMessages({ ...options, selectSourceOrdinal }).map(
      ({ messageUid, sessionOrdinal }) => [messageUid, sessionOrdinal],
    ),
    [
      ["sm-canonical", 4],
      ["sm-other", 2],
    ],
  );
  ordinals.delete(canonical.messageUid);
  assert.throws(() => buildSessionDisplayMessages({ ...options, selectSourceOrdinal }), {
    message: "Display row requires a valid source message ordinal",
  });
});

test("display exposes thinking availability without copying the timeline", () => {
  const assistant = (messageUid, turnScopeId) => ({
    role: "assistant",
    type: "message",
    sessionId: "display-session",
    messageUid,
    modelMessageId: `model-${messageUid}`,
    presentationMessageId: `presentation-${messageUid}`,
    content: messageUid,
    turnScopeId,
    attachments: [],
  });
  const messages = [assistant("first", "a"), assistant("other", "b"), assistant("second", "a")];
  messages[2].toolTimeline = [{ key: "call:example", toolCallId: "example" }];
  const [first, other, second] = buildSessionDisplayMessages({
    messages,
    lifecycle: { turns: {} },
  });
  assert.equal(first.hasThinkingDetails, true);
  assert.equal(second.hasThinkingDetails, true);
  assert.equal(Object.hasOwn(first, "toolTimeline"), false);
  assert.equal(Object.hasOwn(second, "toolTimeline"), false);
  assert.equal(other.hasThinkingDetails, undefined);
});

test("enriched rows and statistics compose across interleaved turns", () => {
  const sessionId = "display-session";
  const user = (messageUid, turnScopeId) => ({
    role: "user",
    type: "message",
    sessionId,
    messageUid,
    turnScopeId,
    content: messageUid,
    attachments: [],
  });
  const canonical = {
    ...user("canonical", "a"),
    role: "assistant",
    modelMessageId: "mm-canonical",
    presentationMessageId: "message-a",
    chatPresentation: true,
    toolTimeline: [{ key: "call:example", toolCallId: "example" }],
  };
  const messages = [user("a1", "a"), user("b1", "b"), user("a2", "a"), canonical];
  const turns = Object.fromEntries(
    ["b", "c"].map((id, index) => [
      id,
      turnRecord({
        turnScopeId: id,
        sequence: index + 1,
        state: "stop_completed",
      }),
    ]),
  );
  const ordinals = new Map(messages.map(({ messageUid }, index) => [messageUid, index + 1]));
  const options = {
    selectSourceOrdinal: ({ messageUid }) => ordinals.get(messageUid),
  };
  const build = (messages, turns) =>
    buildSessionDisplayRowsAndStats(
      { sessionId, messages, turnLifecycle: { activeTurnScopeId: "", turns } },
      countSessionDisplaySources(messages),
      options,
    );
  const full = build(messages, turns);
  const parts = ["c", "b", "a"].map((id) =>
    build(
      messages.filter(({ turnScopeId }) => turnScopeId === id),
      Object.fromEntries(Object.entries(turns).filter(([key]) => key === id)),
    ),
  );
  const key = (entry) =>
    sessionDisplayRowOrderKey(entry, {
      sourceOrdinal: options.selectSourceOrdinal,
      lifecycleSequence: ({ turnScopeId }) => turns[turnScopeId].sequence,
    });
  const sorted = parts
    .flatMap(({ entries }) => entries)
    .sort((left, right) => {
      const a = key(left);
      const b = key(right);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    });
  assert.deepEqual(sorted, full.entries);
  assert.equal(full.stats.thinkingMessageCount, 1);
  for (const [field, value] of Object.entries(full.stats)) {
    const aggregate =
      typeof value === "boolean"
        ? parts.some(({ stats }) => stats[field])
        : parts.reduce((sum, { stats }) => sum + stats[field], 0);
    assert.equal(aggregate, value, field);
  }
});
