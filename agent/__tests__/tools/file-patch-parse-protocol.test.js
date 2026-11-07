/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseApplyPatch, parseUnifiedDiff } from "../../src/tools/execution/file-patch/parse.js";
import { applyPatchHunks } from "../../src/tools/execution/file-patch/apply.js";

const ctx = (text) => ({ type: " ", text });
const del = (text) => ({ type: "-", text });
const add = (text) => ({ type: "+", text });
const numbered = (line, text) => `${String(line).padStart(6)}\t${text}`;
const patch = (body) => `*** Begin Patch\n*** Update File: a.txt\n${body}\n*** End Patch`;

test("both formats produce equivalent edits through one planner", () => {
  const [search] = parseApplyPatch(patch("@@ L2\n-b\n+B"));
  const [unified] = parseUnifiedDiff("--- a.txt\n+++ a.txt\n@@ -2 +2 @@\n-b\n+B\n");
  for (const item of [search, unified]) {
    assert.deepEqual(applyPatchHunks("a\nb\nc\n", item.hunks), {
      content: "a\nB\nc\n",
      adaptations: [],
    });
  }
});

test("unified add accepts only complete added content and preserves missing final newline", () => {
  const [file] = parseUnifiedDiff("--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n", 1);
  assert.equal(file.content, "a\nb\n");
  const [noNewline] = parseUnifiedDiff(
    "--- /dev/null\n+++ x\n@@ -0,0 +1 @@\n+a\n\\ No newline at end of file\n",
  );
  assert.equal(noNewline.content, "a");
  assert.throws(() => parseUnifiedDiff("--- /dev/null\n+++ x\n@@ -1 +1 @@\n a\n+b\n"));
});

test("strict apply parser rejects unknown headers, ignored text, empty edits and trailing data", () => {
  for (const input of [
    patch("@@ function target()\n-x\n+y"),
    patch("@@ L0\n-x\n+y"),
    patch("@@ L9007199254740992\n-x\n+y"),
    patch("@@\n-x\nINVALID\n+y"),
    patch("@@\n x"),
    patch("@@\n"),
    patch("ignored\n@@\n-x\n+y"),
    patch("@@\n-x\n+y") + "\nignored",
    patch("@@\n-x\n+y").replace("*** End Patch", ""),
    "*** Begin Patch\nignored\n*** End Patch",
    "*** Begin Patch\n*** Update File: \n@@\n-x\n+y\n*** End Patch",
  ])
    assert.throws(() => parseApplyPatch(input), { code: "RECOVERABLE_INVALID_INPUT" }, input);
});

test("strict unified parser rejects mixed format, wrong counts and ignored text", () => {
  for (const body of [
    "@@\n-x\n+y",
    "@@ -1,9 +1,10 @@\n-x\n+y",
    "@@ -1 +1 @@\n-x\n+y\nINVALID",
    "@@ -1 +2 @@\n-x\n+y",
    "@@ -1 +1 @@\n x",
    "@@ -1 +1 @@\n-x\n+y\n+extra",
  ])
    assert.throws(() => parseUnifiedDiff(`--- x\n+++ x\n${body}\n`), {
      code: "RECOVERABLE_INVALID_INPUT",
    });
});

test("split context does not convey function scope; continuous context locates uniquely", () => {
  const source = "function target() {\n}\nfunction other() {\n}\n";
  assert.throws(
    () => parseApplyPatch(patch("@@\n function target() {\n@@\n }\n+insert")),
    /must contain a change/,
  );
  const [file] = parseApplyPatch(patch("@@\n function target() {\n }\n+insert"));
  assert.equal(
    applyPatchHunks(source, file.hunks).content,
    "function target() {\n}\ninsert\nfunction other() {\n}\n",
  );
});

test("ambiguous context reports candidates; exact anchors never choose a nearby match", () => {
  const lines = [del("x"), add("y")];
  assert.throws(
    () => applyPatchHunks("x\na\nx\n", [{ lines }]),
    (error) => {
      assert.deepEqual(error.details.candidateLines, [1, 3]);
      return true;
    },
  );
  assert.equal(applyPatchHunks("x\na\nx\n", [{ anchorLine: 3, lines }]).content, "x\na\ny\n");
  assert.throws(() => applyPatchHunks("x\na\nx\n", [{ anchorLine: 2, lines }]), /does not match/);
  assert.throws(
    () => applyPatchHunks("x\na\nx\n", [{ anchorLine: 2, lines: [del("x"), add("y")] }]),
    /does not match/,
  );
});

test("ordered hunks use original coordinates and never reset the cursor", () => {
  const [file] = parseApplyPatch(patch("@@ L1\n-icon\n+hidden\n@@ L3\n-icon\n+hidden\n@@\n-label"));
  assert.equal(
    applyPatchHunks("icon\ngap\nicon\nlabel\n", file.hunks).content,
    "hidden\ngap\nhidden\n",
  );
  assert.throws(
    () =>
      applyPatchHunks("x\na\nx\n", [{ lines: [del("a")] }, { anchorLine: 1, lines: [del("x")] }]),
    (error) => error.details.line === 1 && error.details.cursorLine === 3,
  );

  assert.throws(
    () => applyPatchHunks("x\na\nb\n", [{ lines: [del("b")] }, { lines: [del("x")] }]),
    /does not match/,
  );
});

test("insertions require context or exact anchor including EOF", () => {
  assert.throws(() => applyPatchHunks("a\n", [{ lines: [add("b")] }]), /requires an exact/);
  assert.equal(applyPatchHunks("a\n", [{ anchorLine: 2, lines: [add("b")] }]).content, "a\nb\n");
  assert.throws(
    () => applyPatchHunks("a\n", [{ anchorLine: 3, lines: [add("b")] }]),
    /out of order/,
  );
});

test("numbered input is explicitly adapted before matching for either format", () => {
  const lines = [ctx(numbered(2, "b")), del(numbered(3, "c")), add("C")];
  assert.throws(() => applyPatchHunks("a\nb\nc\n", [{ lines }]), /does not match/);
  for (const hunk of [{ lines }, { anchorLine: 2, unified: true, lines }]) {
    assert.deepEqual(applyPatchHunks("a\nb\nc\n", [hunk], "read_file_numbered"), {
      content: "a\nb\nC\n",
      adaptations: [{ kind: "read_file_numbered", line: 2, lineCount: 2 }],
    });
  }
});

test("numbered encoding rejects gaps, missing prefixes, anchor conflicts and stale text", () => {
  for (const hunk of [
    { lines: [ctx(numbered(1, "a")), del(numbered(3, "c"))] },
    { lines: [ctx(numbered(1, "a")), del("b")] },
    { anchorLine: 1, lines: [del(numbered(2, "b"))] },
    { lines: [del(numbered(2, "stale"))] },
    { lines: [add("literal")] },
  ])
    assert.throws(() => applyPatchHunks("a\nb\nc\n", [hunk], "read_file_numbered"));
});

test("digits and tabs are literal in raw mode and added lines; numbered mode strips one layer", () => {
  const source = "head\n5\tfoo\n";
  assert.deepEqual(applyPatchHunks(source, [{ lines: [del("5\tfoo"), add("7\tbar")] }]), {
    content: "head\n7\tbar\n",
    adaptations: [],
  });
  const adapted = applyPatchHunks(
    source,
    [{ lines: [del(numbered(2, "5\tfoo")), add("7\tbar")] }],
    "read_file_numbered",
  );
  assert.equal(adapted.content, "head\n7\tbar\n");
  assert.equal(adapted.adaptations.length, 1);
});

test("text formatting and unified newline markers survive the unified planner", () => {
  assert.equal(
    applyPatchHunks("\uFEFFa\r\nb\r\n", [{ lines: [del("b"), add("B")] }]).content,
    "\uFEFFa\r\nB\r\n",
  );
  for (const [source, body, expected] of [
    ["a", "-a\n\\ No newline at end of file\n+b", "b\n"],
    ["a\n", "-a\n+b\n\\ No newline at end of file", "b"],
  ]) {
    const [file] = parseUnifiedDiff(`--- x\n+++ x\n@@ -1 +1 @@\n${body}\n`);
    assert.equal(applyPatchHunks(source, file.hunks).content, expected);
  }
  assert.equal(applyPatchHunks("a\n", [{ lines: [del("a")] }]).content, "");
});

const noNewline = "\\ No newline at end of file";
const unified = (body) => parseUnifiedDiff(`--- x\n+++ x\n${body}\n`)[0].hunks;

test("unified old EOF declarations must match actual newline state and location", () => {
  for (const [source, body] of [
    ["a\n", `@@ -1 +1 @@\n-a\n${noNewline}\n+b`],
    ["a", "@@ -1 +1 @@\n-a\n+b"],
    ["a\ntail\n", `@@ -1 +1 @@\n-a\n${noNewline}\n+b`],
    ["a\ntail\n", `@@ -1 +1 @@\n-a\n+b\n${noNewline}`],
    ["a", "@@ -1,0 +2 @@\n+b"],
  ])
    assert.throws(() => applyPatchHunks(source, unified(body)), /newline|unterminated/);
});

test("unified markers terminate their side across lines and hunks, including add/delete", () => {
  for (const body of [
    `@@ -1,2 +1 @@\n-a\n${noNewline}\n-b\n+c`,
    `@@ -1 +1,2 @@\n-a\n+b\n${noNewline}\n+c`,
    `@@ -1 +1 @@\n-a\n+b\n${noNewline}\n@@ -2 +2 @@\n-c\n+d`,
  ])
    assert.throws(() => unified(body), /no-newline marker/);
  assert.throws(
    () => parseUnifiedDiff(`--- /dev/null\n+++ x\n@@ -0,0 +1,2 @@\n+a\n${noNewline}\n+b`),
    /no-newline marker/,
  );
  assert.throws(
    () => parseUnifiedDiff(`--- x\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n${noNewline}\n-b`),
    /no-newline marker/,
  );
});

test("valid EOF transitions preserve exact resulting line terminators", () => {
  for (const [source, body, expected] of [
    ["a", `@@ -1 +1 @@\n-a\n${noNewline}\n+b\n${noNewline}`, "b"],
    ["a\nb", `@@ -2 +1,0 @@\n-b\n${noNewline}`, "a\n"],
    ["a\n", "@@ -1,0 +2 @@\n+b", "a\nb\n"],
    ["", "@@ -0,0 +1 @@\n+a", "a\n"],
    ["a\nb\n", `@@ -1,2 +1 @@\n-a\n+A\n${noNewline}\n-b`, "A"],
  ])
    assert.equal(applyPatchHunks(source, unified(body)).content, expected);
});
