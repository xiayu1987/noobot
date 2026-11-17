/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { projectSessionRecordToContextMessage } from "../src/message/session-projection.js";
import { markContextMessageSummarized } from "../src/message/codec.js";

function record() {
  return {
    messageUid: "message-1",
    role: "assistant",
    content: "content",
    dialogProcessId: "dialog-1",
    turnScopeId: "scope-1",
    tool_calls: [{ id: "call-1", name: "read_file", args: {} }],
    rawModelContent: [{ type: "text", text: "content" }],
    attachments: [{ attachmentRef: "attach://a1" }],
    userMetaParsedResults: [{ parsed: "value" }],
  };
}

test("immutable source projections retain independent mutable messages and metadata", () => {
  const source = deepFreeze(record());
  const first = projectSessionRecordToContextMessage(source);
  const second = projectSessionRecordToContextMessage(source);
  assert.deepEqual(first, projectSessionRecordToContextMessage(record()));
  assert.notEqual(first, second);
  assert.notEqual(first.additional_kwargs, second.additional_kwargs);
  assert.equal(first.tool_calls, source.tool_calls);
  for (const key of ["attachments", "rawModelContent", "userMetaParsedResults"])
    assert.equal(first.additional_kwargs[key], source[key]);
  markContextMessageSummarized(first);
  first.content = "edited";
  first.additional_kwargs.dialogProcessId = "edited";
  delete first.additional_kwargs.messageUid;
  assert.deepEqual(projectSessionRecordToContextMessage(source), second);
  assert.equal(second.additional_kwargs.summarized, undefined);
  assert.equal(source.content, "content");
});

test("mutable sources and shallow frozen dynamic sources are reobserved", () => {
  const source = record();
  projectSessionRecordToContextMessage(source);
  source.summarized = true;
  source.content = "changed";
  assert.equal(projectSessionRecordToContextMessage(source).content, "changed");
  assert.equal(projectSessionRecordToContextMessage(source).additional_kwargs.summarized, true);
  let content = "before";
  const dynamic = deepFreeze({
    ...record(),
    get content() {
      return content;
    },
  });
  assert.equal(projectSessionRecordToContextMessage(dynamic).content, "before");
  content = "after";
  assert.equal(projectSessionRecordToContextMessage(dynamic).content, "after");
  source.contextPolicy = [];
  assert.throws(() => projectSessionRecordToContextMessage(source), /contextPolicy/);
});

test("failed immutable projections preserve validation errors on every read", () => {
  const invalid = deepFreeze({ ...record(), injectedBy: "harness" });
  for (let attempt = 0; attempt < 2; attempt++)
    assert.throws(() => projectSessionRecordToContextMessage(invalid), /injected context message/);
});
