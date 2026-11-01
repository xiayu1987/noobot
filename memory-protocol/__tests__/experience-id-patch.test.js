/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseKvPayload } from "../src/experience/id-patch.js";
import { collectPatchItemsByFieldMap } from "../src/experience/patch-items.js";

const cases = [
  ["", {}],
  ["  DOMAIN = software engineering\tnew = true ", { domain: "software engineering", new: "true" }],
  ["_key-2=value other_3=next", { "_key-2": "value", other_3: "next" }],
  ['title="a next=value b" next=done', { title: "a next=value b", next: "done" }],
  ["title='a next=value b' next=done", { title: "a next=value b", next: "done" }],
  [String.raw`title="a \"quoted\" value" next=done`, { title: 'a "quoted" value', next: "done" }],
  [String.raw`title='it\'s ready' next=done`, { title: "it's ready", next: "done" }],
  [String.raw`path="C:\work\file" next=done`, { path: String.raw`C:\work\file`, next: "done" }],
  ['title="" next=done', { title: "", next: "done" }],
  ["value=one word without assignment", { value: "one word without assignment" }],
  ["value=embedded=a=b next = c", { value: "embedded=a=b", next: "c" }],
  ["value=one 2invalid=still value next=done", { value: "one 2invalid=still value", next: "done" }],
  ["value=one\n\tother = two", { value: "one", other: "two" }],
  ["key=first KEY=last", { key: "last" }],
  ["key=", { key: "" }],
  ["missing assignment next=value", {}],
  ["key=first =invalid next=value", { key: "first" }],
  ['key="unterminated next=value', { key: '"unterminated next=value' }],
  ['key="ends with slash\\', { key: '"ends with slash\\' }],
  ['key="one"next=two', { key: "one", next: "two" }],
];

for (const [input, expected] of cases) {
  test(`experience key/value scanning: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseKvPayload(input), expected);
  });
}

test("experience patch collection consumes the canonical key/value scanner", () => {
  assert.deepEqual(
    collectPatchItemsByFieldMap({
      rawContent:
        'ADD E1 domain="software engineering" experiences="one||two"\nUPDATE E1 domain=testing experiences=three||four',
      idPrefix: "E",
      fieldMap: {
        domain: { key: "domain", type: "text" },
        experiences: { key: "experiences", type: "list" },
      },
      requiredFields: ["domain"],
    }),
    [{ domain: "testing", experiences: ["three", "four"] }],
  );
});
