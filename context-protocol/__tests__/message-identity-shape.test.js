/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_MESSAGE_IDENTITY_SHAPE,
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  assignContextMessageIdentity,
  composeContextProjectionKey,
  inspectContextMessageIdentity,
  resolveContextMessageIdentity,
  resolveContextMessageKey,
  resolveContextSourceMessageUid,
} from "../src/message/codec.js";

function message(metadata) {
  return { role: "user", content: "x", additional_kwargs: metadata };
}

const VALID_SHAPES = [
  {
    metadata: { messageUid: "sm_1" },
    shape: CONTEXT_MESSAGE_IDENTITY_SHAPE.SESSION,
    key: "sm_1",
    source: "sm_1",
  },
  {
    metadata: { contextMessageId: "cm_1" },
    shape: CONTEXT_MESSAGE_IDENTITY_SHAPE.CONTEXT,
    key: "cm_1",
    source: "",
  },
  {
    metadata: {
      projectionType: CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META,
      sourceMessageUid: "sm_1",
    },
    shape: CONTEXT_MESSAGE_IDENTITY_SHAPE.MESSAGE_PROJECTION,
    key: composeContextProjectionKey(CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META, "sm_1"),
    source: "sm_1",
  },
  {
    metadata: {
      projectionType: CONTEXT_MESSAGE_PROJECTION_TYPE.PHASE_SUMMARY,
      sourceMessageUid: "sm_2",
    },
    shape: CONTEXT_MESSAGE_IDENTITY_SHAPE.MESSAGE_PROJECTION,
    key: composeContextProjectionKey(CONTEXT_MESSAGE_PROJECTION_TYPE.PHASE_SUMMARY, "sm_2"),
    source: "sm_2",
  },
  {
    metadata: {
      projectionType: CONTEXT_MESSAGE_PROJECTION_TYPE.TERMINAL_STATUS,
      sourceTurnScopeId: "t_1",
    },
    shape: CONTEXT_MESSAGE_IDENTITY_SHAPE.TURN_PROJECTION,
    key: composeContextProjectionKey(CONTEXT_MESSAGE_PROJECTION_TYPE.TERMINAL_STATUS, "t_1"),
    source: "",
  },
];

test("each valid identity shape resolves its shape, key and session source", () => {
  for (const { metadata, shape, key, source } of VALID_SHAPES) {
    const value = message(metadata);
    assert.equal(resolveContextMessageIdentity(value).shape, shape);
    assert.equal(resolveContextMessageKey(value), key);
    assert.equal(resolveContextSourceMessageUid(value), source);
  }
});

test("projection keys of one source are distinct per type and never equal the session key", () => {
  const keys = VALID_SHAPES.map(({ metadata }) => resolveContextMessageKey(message(metadata)));
  assert.equal(new Set(keys).size, keys.length);
});

test("identity rejects missing, mixed and mismatched shapes", () => {
  const invalid = [
    {},
    { messageUid: "sm_1", contextMessageId: "cm_1" },
    { messageUid: "sm_1", projectionType: "user_meta", sourceMessageUid: "sm_1" },
    { projectionType: "user_meta" },
    { sourceMessageUid: "sm_1" },
    { projectionType: "user_meta", sourceTurnScopeId: "t_1" },
    { projectionType: "terminal_status", sourceMessageUid: "sm_1" },
    { projectionType: "unknown", sourceMessageUid: "sm_1" },
  ];
  for (const metadata of invalid) {
    assert.throws(
      () => resolveContextMessageIdentity(message(metadata)),
      /context message identity must be exactly one shape/,
      JSON.stringify(metadata),
    );
  }
});

test("projection keys require a known type and a source", () => {
  assert.throws(() => composeContextProjectionKey("unknown", "sm_1"), /known type and source/);
  assert.throws(() => composeContextProjectionKey("user_meta", ""), /known type and source/);
});

test("identity inspection reports shapes without enforcing them", () => {
  for (const { metadata, shape, key } of VALID_SHAPES) {
    const inspected = inspectContextMessageIdentity(message(metadata));
    assert.equal(inspected.shape, shape);
    assert.equal(inspected.key, key);
    assert.deepEqual(inspected.fields, metadata);
  }
  assert.deepEqual(inspectContextMessageIdentity({ type: "human", content: "x" }), {
    shape: "",
    key: "",
    fields: {},
  });
  const mixed = { messageUid: "sm_1", contextMessageId: "cm_1" };
  assert.deepEqual(inspectContextMessageIdentity(message(mixed)), {
    shape: "",
    key: "",
    fields: mixed,
  });
});

test("assignContextMessageIdentity stamps one context identity and rejects existing identity", () => {
  const stamped = assignContextMessageIdentity({ role: "system", content: "x" });
  const identity = resolveContextMessageIdentity(stamped);
  assert.equal(identity.shape, CONTEXT_MESSAGE_IDENTITY_SHAPE.CONTEXT);
  assert.match(identity.contextMessageId, /^cm_/);
  assert.throws(
    () => assignContextMessageIdentity(stamped),
    /already carries identity: contextMessageId/,
  );
  assert.throws(
    () => assignContextMessageIdentity(message({ messageUid: "sm_1" })),
    /already carries identity: messageUid/,
  );
});
