/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import {
  encodeSessionPageSnapshotCursor,
  requireDisplayArtifactPageTransition,
  requireRetainedDisplayArtifactPageResponse,
  createMessageContentPage,
  decodeThinkingDetailPageQuery,
  createMessageReadBudget,
  MESSAGE_READ_BUDGET_ERROR,
  requireMessagePage,
  requireScopedThinkingDetailPage,
  requireThinkingDetailPageSelection,
  prepareThinkingDetailPageTransition,
  requireThinkingDetailPageResponse,
  requireScopedTurnMessagePage,
  nextSessionMessagePageCursor,
  requireMessageContentPage,
  requireMessageReadSelection,
  messageContentReadError,
  sessionMessagePageLength,
  requirePageSnapshotPolicy,
  requireForwardSessionMessagePage,
} from "../src/message-read-budget.js";

test("forward session pages cannot change pinned counts or skip positions", () => {
  const generation = 3;
  const first = {
    generation,
    messageCount: 2,
    records: [{ ordinal: 1 }],
    nextCursor: { scope: "snapshot", after: 1 },
  };
  const start = { generation, cursor: null, limit: 1 };
  const resume = { ...start, cursor: first.nextCursor };
  const last = { generation, messageCount: 2, records: [{ ordinal: 2 }], nextCursor: null };
  assert.equal(requireForwardSessionMessagePage(first, start, null), first);
  assert.equal(requireForwardSessionMessagePage(last, resume, first.messageCount), last);
  for (const invalid of [
    { ...last, generation: 4 },
    { ...last, messageCount: 1, records: [] },
    { ...last, records: [{ ordinal: 1 }] },
    { ...last, records: [{ ordinal: 2 }, { ordinal: 3 }] },
  ])
    assert.throws(() => requireForwardSessionMessagePage(invalid, resume, first.messageCount), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  assert.throws(
    () =>
      requireForwardSessionMessagePage(
        { ...first, nextCursor: { ...first.nextCursor, after: 2 } },
        start,
        null,
      ),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  const middle = { ...last, messageCount: 3, nextCursor: { after: 2, scope: "foreign" } };
  assert.throws(() => requireForwardSessionMessagePage(middle, resume, 3), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("page snapshot retention requires independent capacity, idle and lifetime budgets", () => {
  const policy = { readers: 2, idleMs: 10, maxAgeMs: 30 };
  assert.equal(requirePageSnapshotPolicy(policy), policy);
  for (const field of ["readers", "idleMs", "maxAgeMs"]) {
    for (const value of [undefined, null, 0, -1, Infinity, 1.5, "10"])
      assert.throws(() => requirePageSnapshotPolicy({ ...policy, [field]: value }), TypeError);
  }
  for (const limits of [null, undefined, [], false])
    assert.throws(() => requirePageSnapshotPolicy(limits), TypeError);
});

test("retained artifact pages reserve records for adjacent pages without counting sparse offsets", () => {
  const key = { sessionId: "session", dialogProcessId: "dialog", turnScopeId: "turn" };
  const selection = { ...key, cursor: null, limit: 2, maxBytes: 4096 };
  const cursorAt = (after, token = "lease") =>
    encodeSessionPageSnapshotCursor(token, { after, scope: "artifact-snapshot" });
  const record = (ordinal) => ({
    ordinal,
    message: {
      ...key,
      type: "tool_result",
      messageUid: `message-${ordinal}`,
      contentReference: "version",
      contentBytes: 10,
    },
  });
  const page = {
    generation: 3,
    summary: {
      status: "unassigned",
      ownerPresentationMessageId: null,
      toolArtifactCount: 3,
      assignedAttachmentCount: 0,
    },
    records: [record(120)],
    nextCursor: cursorAt(40),
  };
  assert.equal(requireRetainedDisplayArtifactPageResponse(page, selection), page);
  const continuation = { ...selection, cursor: page.nextCursor };
  const middle = { ...page, records: [record(125)], nextCursor: cursorAt(57) };
  assert.equal(requireRetainedDisplayArtifactPageResponse(middle, continuation), middle);
  const last = { ...page, records: [record(125), record(160)], nextCursor: null };
  assert.equal(requireRetainedDisplayArtifactPageResponse(last, continuation), last);
  assert.equal(requireDisplayArtifactPageTransition(page, selection, null), page);
  assert.equal(requireDisplayArtifactPageTransition(last, continuation, page), last);
  for (const previous of [null, last]) {
    assert.throws(() => requireDisplayArtifactPageTransition(last, continuation, previous), {
      message: "Display artifact continuation requires its previous page",
    });
  }
  assert.throws(
    () =>
      requireDisplayArtifactPageTransition(last, continuation, {
        ...page,
        nextCursor: cursorAt(39),
      }),
    { message: "Request does not continue the previous display artifact page" },
  );
  for (const changed of [
    { ...last, generation: 4 },
    { ...last, summary: { ...last.summary, toolArtifactCount: 4 } },
    {
      ...last,
      summary: { ...last.summary, status: "assigned", ownerPresentationMessageId: "owner" },
    },
  ]) {
    assert.throws(() => requireDisplayArtifactPageTransition(changed, continuation, page), {
      message: "Display artifact page changed its retained snapshot facts",
    });
  }
  for (const invalid of [
    { ...middle, records: last.records },
    { ...middle, nextCursor: cursorAt(57, "foreign-lease") },
    { ...middle, nextCursor: cursorAt(40) },
    { ...last, summary: { ...page.summary, toolArtifactCount: 2 } },
    { ...last, records: [] },
  ]) {
    assert.throws(
      () => requireRetainedDisplayArtifactPageResponse(invalid, continuation),
      TypeError,
    );
  }
  for (const change of [{ content: null }, { contentReference: null }, { contentBytes: 1 }]) {
    assert.throws(
      () =>
        requireRetainedDisplayArtifactPageResponse(
          {
            ...page,
            records: [{ ...record(120), message: { ...record(120).message, ...change } }],
          },
          selection,
        ),
      /requires a versioned content reference without inline content/,
    );
  }
});

test("thinking page transport rejects malformed and duplicate values using one contract", () => {
  assert.deepEqual(decodeThinkingDetailPageQuery({ limit: "1" }), { cursor: null, limit: 1 });
  const cursor = { scope: "snapshot", after: 1 };
  assert.deepEqual(decodeThinkingDetailPageQuery({ limit: "1", cursor: JSON.stringify(cursor) }), {
    cursor,
    limit: 1,
  });
  for (const query of [
    {},
    { limit: ["1", "2"] },
    { limit: "1e1" },
    { limit: " 1" },
    { limit: "01" },
    { limit: "0" },
    { limit: "99999999999999999" },
    { limit: "1", cursor: "{" },
    { limit: "1", cursor: ["null", "null"] },
    { limit: "1", cursor: "{}" },
    { limit: "1", cursor: "false" },
    { limit: "1", cursor: '{"scope":"s","after":0}' },
  ])
    assert.throws(() => decodeThinkingDetailPageQuery(query), {
      code: "SESSION_PAGE_REQUEST_INVALID",
      statusCode: 400,
    });
});

test("thinking detail validates one bounded selection before storage or transport work", () => {
  const selection = {
    sessionId: "session",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    cursor: null,
    limit: 1,
  };
  assert.equal(requireThinkingDetailPageSelection(selection), selection);
  for (const change of [
    { sessionId: " session" },
    { dialogProcessId: "" },
    { turnScopeId: " turn" },
    { limit: 0 },
    { limit: Infinity },
    { limit: 1.5 },
    { limit: QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize + 1 },
    { cursor: undefined },
    { cursor: {} },
    { cursor: { after: 0, scope: "snapshot" } },
    { cursor: { after: 1, scope: " snapshot" } },
    { cursor: { after: 1, scope: "snapshot", extra: true } },
    { cursor: { after: Number.MAX_SAFE_INTEGER + 1, scope: "snapshot" } },
  ])
    assert.throws(() => requireThinkingDetailPageSelection({ ...selection, ...change }), TypeError);
  assert.throws(
    () =>
      requireScopedThinkingDetailPage(["session", "format", "revision"], {
        lookupKey: { dialogProcessId: "dialog", turnScopeId: "turn" },
        cursor: null,
        limit: QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize + 1,
      }),
    TypeError,
  );
});

test("thinking detail response rejects identity drift, sparse pages and invalid continuation boundaries", () => {
  const selection = {
    sessionId: "session",
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    cursor: null,
    limit: 2,
  };
  const message = { sessionId: "session", dialogProcessId: "dialog", turnScopeId: "turn" };
  const first = {
    exists: true,
    ...message,
    generation: 3,
    messageCount: 2,
    messages: [message],
    nextCursor: { after: 1, scope: "snapshot" },
  };
  assert.equal(requireThinkingDetailPageResponse(first, selection), first);
  const retainedFirst = {
    ...first,
    nextCursor: encodeSessionPageSnapshotCursor("reader", first.nextCursor),
  };
  assert.equal(prepareThinkingDetailPageTransition(selection, null)(retainedFirst), retainedFirst);
  assert.throws(() => prepareThinkingDetailPageTransition(selection, null)(first), TypeError);
  assert.throws(() => prepareThinkingDetailPageTransition(selection, retainedFirst), TypeError);
  const lastSelection = { ...selection, cursor: first.nextCursor };
  const last = { ...first, nextCursor: null };
  assert.equal(requireThinkingDetailPageResponse(last, lastSelection), last);
  const retainedSelection = { ...selection, cursor: { ...retainedFirst.nextCursor } };
  const acceptLast = prepareThinkingDetailPageTransition(retainedSelection, retainedFirst);
  assert.equal(acceptLast(last), last);
  assert.throws(() => prepareThinkingDetailPageTransition(retainedSelection, null), TypeError);
  for (const nextCursor of [
    null,
    { ...retainedFirst.nextCursor, after: 2 },
    encodeSessionPageSnapshotCursor("other-reader", first.nextCursor),
    encodeSessionPageSnapshotCursor("reader", { after: 1, scope: "foreign" }),
  ])
    assert.throws(
      () =>
        prepareThinkingDetailPageTransition(retainedSelection, { ...retainedFirst, nextCursor }),
      /previous thinking detail page/,
    );
  assert.deepEqual(requireThinkingDetailPageResponse({ exists: false }, selection), {
    exists: false,
  });
  assert.throws(() => acceptLast({ exists: false }), TypeError);
  for (const change of [
    { sessionId: "foreign" },
    { dialogProcessId: "foreign" },
    { turnScopeId: "foreign" },
    { generation: 0 },
    { generation: 1.5 },
    { messageCount: 0 },
    { messageCount: 1.5 },
    { messages: [] },
    { messages: new Array(1) },
    { messages: [null] },
    { messages: [{ ...message, turnScopeId: "foreign" }] },
    { messages: [message, message, message] },
    { nextCursor: null },
    { nextCursor: { after: 0, scope: "snapshot" } },
    { nextCursor: { after: 1, scope: "snapshot", extra: true } },
    { nextCursor: { after: 1, scope: " snapshot" } },
  ])
    assert.throws(
      () => requireThinkingDetailPageResponse({ ...first, ...change }, selection),
      TypeError,
    );
  for (const change of [
    { generation: 4 },
    { messageCount: 3 },
    { nextCursor: first.nextCursor },
    { messageCount: 3, nextCursor: { after: 2, scope: "foreign" } },
  ])
    assert.throws(() => acceptLast({ ...last, ...change }), TypeError);
  assert.throws(
    () =>
      requireThinkingDetailPageResponse(
        { ...last, messageCount: 3, nextCursor: { after: 2, scope: "foreign" } },
        lastSelection,
      ),
    TypeError,
  );
});

test("message pages accept an empty first page and reject continuations at or beyond the end", () => {
  assert.equal(sessionMessagePageLength(0, 0, 2), 0);
  assert.equal(sessionMessagePageLength(0, 3, 2), 2);
  assert.equal(sessionMessagePageLength(2, 3, 2), 1);
  for (const [after, count] of [
    [1, 0],
    [3, 3],
    [4, 3],
  ]) {
    assert.throws(() => sessionMessagePageLength(after, count, 2), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
  }
});

test("thinking detail continuations bind the session, revision, purpose and Turn", () => {
  const identity = ["session", "format", "revision"];
  const selection = {
    lookupKey: { dialogProcessId: "dialog", turnScopeId: "turn" },
    cursor: null,
    limit: 1,
    maxBytes: 128,
  };
  const { position } = requireScopedThinkingDetailPage(identity, selection);
  const cursor = nextSessionMessagePageCursor(position, 1, true);
  const continuation = { ...selection, cursor };
  assert.equal(requireScopedThinkingDetailPage(identity, continuation).position.after, 1);
  const conflict = { code: "SESSION_PAGE_CURSOR_CONFLICT" };
  assert.throws(() => requireScopedTurnMessagePage(identity, continuation), conflict);
  assert.throws(
    () => requireScopedThinkingDetailPage(["session", "format", "new-revision"], continuation),
    conflict,
  );
  assert.throws(
    () => requireScopedThinkingDetailPage(["another-session", ...identity.slice(1)], continuation),
    conflict,
  );
  for (const change of [{ turnScopeId: "other" }, { dialogProcessId: "other" }]) {
    assert.throws(
      () =>
        requireScopedThinkingDetailPage(identity, {
          ...continuation,
          lookupKey: { ...selection.lookupKey, ...change },
        }),
      conflict,
    );
  }
});

test("message read bytes accumulate across records and failed charges preserve the budget", () => {
  const budget = createMessageReadBudget(100);
  budget.consume("bytes", 40);
  assert.throws(() => budget.consume("bytes", 61), {
    code: MESSAGE_READ_BUDGET_ERROR,
    used: 40,
    requested: 61,
    limit: 100,
  });
  budget.consume("bytes", 60);
  assert.throws(() => budget.consume("bytes", 1), { code: MESSAGE_READ_BUDGET_ERROR });
});

test("message page contract rejects unbounded budgets and malformed work before any reads", () => {
  for (const maxBytes of [
    0,
    -1,
    0.5,
    Infinity,
    NaN,
    null,
    LENGTH_THRESHOLDS.sessionStorage.messageReadBytes + 1,
  ])
    assert.throws(() => createMessageReadBudget(maxBytes), TypeError);
  const budget = createMessageReadBudget(10);
  for (const amount of [-1, 0.5, Infinity, NaN])
    assert.throws(() => budget.consume("bytes", amount), TypeError);
  assert.throws(() => budget.consume("unknown", 0), TypeError);
  for (const change of [
    { turnScopeId: " " },
    { after: -1 },
    { after: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 },
    { maxBytes: Infinity },
  ])
    assert.throws(
      () => requireMessagePage({ turnScopeId: "turn", after: 0, limit: 1, ...change }),
      TypeError,
    );
});

test("message selection bounds total records and shares one byte budget", () => {
  const budget = requireMessageReadSelection({ messageUids: ["first", "second"], maxBytes: 10 });
  budget.consume("bytes", 6);
  assert.throws(() => budget.consume("bytes", 5), { code: MESSAGE_READ_BUDGET_ERROR });
  for (const messageUids of [
    null,
    "first",
    [""],
    [" first"],
    ["first", "first"],
    Array.from(
      { length: QUANTITY_THRESHOLDS.immutableStorage.messagePageSize + 1 },
      (_, index) => `m-${index}`,
    ),
  ])
    assert.throws(() => requireMessageReadSelection({ messageUids }), TypeError);
  assert.throws(
    () => requireMessageReadSelection({ messageUids: [], maxBytes: Infinity }),
    TypeError,
  );
});

test("content page continuations require explicit budgets and content versions", () => {
  const first = {
    messageUid: "message",
    byteOffset: 0,
    maxBytes: 1,
    expectedContentReference: null,
  };
  requireMessageContentPage(first);
  requireMessageContentPage({ ...first, byteOffset: 1, expectedContentReference: "version" });
  for (const override of [
    { messageUid: " " },
    { unexpected: true },
    { byteOffset: -1 },
    { byteOffset: 0.5 },
    { byteOffset: Number.MAX_SAFE_INTEGER + 1 },
    { byteOffset: 1 },
    { maxBytes: 0 },
    { maxBytes: Infinity },
    { maxBytes: LENGTH_THRESHOLDS.sessionStorage.messageReadBytes + 1 },
    { maxBytes: undefined },
    { expectedContentReference: undefined },
    { expectedContentReference: "" },
    { expectedContentReference: " version" },
    { expectedContentReference: "x".repeat(257) },
  ])
    assert.throws(() => requireMessageContentPage({ ...first, ...override }), TypeError);
  for (const malformed of [null, [], {}, Object.create(first)])
    assert.throws(() => requireMessageContentPage(malformed), TypeError);
});

test("content pages advance by UTF-8 bytes, including splits within a character or escape", () => {
  const text = '中\n"\\\u{1F642}';
  const encoded = new TextEncoder().encode(JSON.stringify(text));
  const options = { generation: 3, contentReference: "version", totalBytes: encoded.length };
  const read = (byteOffset, bytes) =>
    createMessageContentPage({
      ...options,
      selection: requireMessageContentPage({
        messageUid: "message",
        byteOffset,
        maxBytes: 1,
        expectedContentReference: "version",
      }),
      bytes,
    });
  let offset = 0;
  const chunks = [];
  do {
    const page = read(offset, encoded.subarray(offset, offset + 1));
    assert.equal(page.encoding, "json-utf8-base64");
    assert.equal(page.byteOffset, offset);
    assert.equal(page.nextByteOffset, offset + 1);
    assert.equal(page.hasMore, page.nextByteOffset < encoded.length);
    chunks.push(Buffer.from(page.dataBase64, "base64"));
    offset = page.nextByteOffset;
  } while (offset < encoded.length);
  assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")), text);
  const end = read(offset, new Uint8Array());
  assert.equal(end.nextByteOffset, offset);
  assert.equal(end.hasMore, false);
  assert.throws(() => read(offset + 1, new Uint8Array()), RangeError);
  assert.throws(() => read(0, new Uint8Array()), TypeError);
  assert.throws(() => read(0, encoded), TypeError);
});

test("content page errors define one transport-independent retry contract", () => {
  assert.equal(messageContentReadError("missing", "missing").statusCode, 404);
  assert.equal(messageContentReadError("version", "changed").statusCode, 409);
  assert.equal(
    messageContentReadError("version", "changed").code,
    "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT",
  );
  assert.throws(() => messageContentReadError("unknown", "invalid"), TypeError);
});
