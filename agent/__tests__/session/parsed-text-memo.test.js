/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createParsedTextMemo } from "../../src/shared/storage/parsed-text-memo.js";

test("parsed text memo reparses only when the stored text changes", () => {
  let parses = 0;
  const parse = createParsedTextMemo((raw) => {
    parses += 1;
    return JSON.parse(raw);
  });
  const first = parse('{"nodes":{"a":1}}', "tree.json");
  assert.equal(parse('{"nodes":{"a":1}}', "tree.json"), first);
  assert.equal(parses, 1);
  assert.equal(Object.isFrozen(first.nodes), true);
  assert.deepEqual(parse('{"nodes":{"b":2}}', "tree.json"), { nodes: { b: 2 } });
  assert.deepEqual(parse('{"nodes":{"a":1}}', "other.json"), { nodes: { a: 1 } });
  assert.equal(parses, 3);
  assert.throws(() => createParsedTextMemo(null), TypeError);
});
