/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePatchInput,
  createPatchReadVersions,
  resolvePatchReadVersions,
} from "../src/index.js";

const hunk = "@@ L1\n-old\n+new";
const complete = `*** Begin Patch\n*** Update File: a\n${hunk}\n*** End Patch`;

test("complete and explicitly targeted shorthand converge to the same patch", () => {
  for (const input of [
    { patch: complete },
    { patch: hunk, filePath: "a" },
    { patch: `*** Begin Patch\n${hunk}`, filePath: "a" },
    { patch: `*** Update File: a\n${hunk}` },
    { patch: complete.replace("*** End Patch", "") },
    { patch: hunk, baseVersions: [{ filePath: "a", sha256: "a".repeat(64) }] },
  ]) {
    const result = normalizePatchInput(input);
    assert.equal(result.patch, complete);
    assert.equal(result.format, "apply_patch");
    assert.equal(result.adaptations.length > 0, input.patch !== complete);
  }
});

test("normalization never guesses targets, mixes formats or discards trailing data", () => {
  for (const input of [
    { patch: hunk },
    { patch: hunk, baseVersions: [{ filePath: "a" }, { filePath: "b" }] },
    { patch: hunk, filePath: "a\n*** Delete File: b" },
    { patch: `${hunk}\n*** Update File: b\n${hunk}`, filePath: "a" },
    { patch: complete, format: "unified_diff" },
    { patch: "hello" },
    { patch: complete, filePath: "b" },
  ])
    assert.throws(() => normalizePatchInput(input), TypeError);
  const trailing = `${complete}\nignored`;
  assert.equal(normalizePatchInput({ patch: trailing }).patch, trailing);
});

test("visible read versions are immutable, batch ordered and preserve parallel ambiguity", () => {
  const locator = { view: "workspace", path: "a" };
  const old = "a".repeat(64);
  const fresh = "b".repeat(64);
  const target = [{ locator, absent: "forbidden" }];
  const parallel = createPatchReadVersions([
    { locator, sha256: old, batch: 1 },
    { locator, sha256: fresh, batch: 1 },
  ]);
  assert.throws(() => resolvePatchReadVersions(target, parallel), /read these files again/);
  const ordered = createPatchReadVersions([
    { locator, sha256: fresh, batch: 2 },
    { locator, sha256: old, batch: 1 },
  ]);
  assert.deepEqual(resolvePatchReadVersions(target, ordered), [{ filePath: "a", sha256: fresh }]);
  assert.throws(() => ordered[0].hashes.push(old), TypeError);
  assert.deepEqual(resolvePatchReadVersions([{ locator, absent: "required" }], ordered), [
    { filePath: "a", sha256: null },
  ]);
  assert.deepEqual(resolvePatchReadVersions([{ locator, absent: "allowed" }]), [
    { filePath: "a", sha256: null },
  ]);
  assert.throws(
    () => resolvePatchReadVersions(target),
    (error) => {
      assert.deepEqual(error.details.pathsToRead, ["a"]);
      return true;
    },
  );
});

test("mount identities remain separate and invalid read observations are rejected", () => {
  const locator = { view: "mount", mount: "/one", path: "a" };
  const reads = createPatchReadVersions([{ locator, sha256: "a".repeat(64), batch: 0 }]);
  assert.throws(
    () =>
      resolvePatchReadVersions(
        [{ locator: { ...locator, mount: "/two" }, absent: "forbidden" }],
        reads,
      ),
    /\/two\/a/,
  );
  assert.throws(
    () => createPatchReadVersions([{ locator, sha256: "a".repeat(62), batch: 0 }]),
    TypeError,
  );
});
