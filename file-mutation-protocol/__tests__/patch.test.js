/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptPatchHunks,
  formatLinesWithNumbers,
  indexPatchBaseVersions,
  indexPatchOperations,
  decodePatchText,
  encodePatchText,
} from "../src/index.js";
import { decodeFileText } from "../src/text-codec-node.js";

const old = (text) => ({ type: "-", text });
const add = (text) => ({ type: "+", text });
const sha256 = "a".repeat(64);

test("read numbering and patch decoding share one protocol without changing caller input", () => {
  const original = [{ lines: [old(formatLinesWithNumbers(["5\told"], 42)), add("7\tnew")] }];
  const snapshot = structuredClone(original);
  const result = adaptPatchHunks(original, "read_file_numbered");
  assert.deepEqual(result.hunks, [{ anchorLine: 42, lines: [old("5\told"), add("7\tnew")] }]);
  assert.deepEqual(original, snapshot);
  assert.equal(result.adaptations[0].line, 42);
});

test("raw decoding is identity and unsupported encodings fail explicitly", () => {
  const hunks = [{ lines: [old("42\tliteral"), add("new")] }];
  assert.equal(adaptPatchHunks(hunks, "raw").hunks[0], hunks[0]);
  assert.throws(() => adaptPatchHunks(hunks, "guess"), /unsupported/);
});

test("numbered decoding rejects inconsistent representation and conflicting location", () => {
  for (const hunk of [
    { lines: [old("1\ta"), old("3\tb")] },
    { lines: [old("1\ta"), old("b")] },
    { lines: [old("0\ta")] },
    { anchorLine: 4, lines: [old("1\ta")] },
    { lines: [add("literal")] },
  ])
    assert.throws(() => adaptPatchHunks([hunk], "read_file_numbered"));
});

test("one baseline covers repeated operations and aliases to the same resolved file", () => {
  const targets = [
    { filePath: "a", identity: "/a" },
    { filePath: "./a", identity: "/a" },
    { filePath: "b", identity: "/b" },
  ];
  const result = indexPatchBaseVersions(
    [
      { filePath: "a", sha256 },
      { filePath: "b", sha256: null },
    ],
    targets,
  );
  assert.deepEqual(
    [...result],
    [
      ["/a", sha256],
      ["/b", null],
    ],
  );
  assert.throws(
    () =>
      indexPatchBaseVersions(
        [
          { filePath: "a", sha256 },
          { filePath: "./a", sha256 },
          { filePath: "b", sha256: null },
        ],
        targets,
      ),
    /duplicate/,
  );
});

test("baseline index rejects missing, unrelated and invalid versions", () => {
  const targets = [{ filePath: "a", identity: "/a" }];
  for (const versions of [
    [],
    [{ filePath: "b", sha256 }],
    [{ filePath: "a", sha256: "short" }],
    [{ filePath: "a", sha256: 42 }],
  ]) {
    assert.throws(() => indexPatchBaseVersions(versions, targets));
  }
});

test("operation graph composes snapshot moves into one final state per identity", () => {
  const move = (source, destination) => ({ mode: "move", source, destination });
  const operations = [move("a", "b"), move("b", "c")];
  const original = structuredClone(operations);
  const result = indexPatchOperations(operations);
  assert.deepEqual(
    [...result.writes],
    [
      ["b", 0],
      ["c", 1],
    ],
  );
  assert.deepEqual([...result.deletes], [["a", 0]]);
  assert.deepEqual(operations, original);
  assert.equal(indexPatchOperations([move("a", "b"), move("b", "a")]).deletes.size, 0);
  assert.throws(() => indexPatchOperations([move("a", "b"), move("a", "c")]), /source/);
  assert.throws(() => indexPatchOperations([move("a", "c"), move("b", "c")]), /destination/);
  assert.throws(() => indexPatchOperations([{ mode: "unknown" }]), /unknown/);
});

test("text decoding separates BOM metadata and preserves body line coordinates", () => {
  assert.deepEqual(decodePatchText("\uFEFFa\r\nb\r\n"), {
    bom: "\uFEFF",
    lines: ["a", "b"],
    endings: ["\r\n", "\r\n"],
    finalNewline: true,
    ending: "\r\n",
    textFormat: {
      encoding: "utf-8",
      bom: true,
      finalNewline: true,
      lineEnding: "crlf",
      insertionEnding: "\r\n",
    },
  });
  assert.deepEqual(decodePatchText(""), {
    bom: "",
    lines: [],
    endings: [],
    finalNewline: false,
    ending: "\n",
    textFormat: {
      encoding: "utf-8",
      bom: false,
      finalNewline: false,
      lineEnding: "none",
      insertionEnding: "\n",
    },
  });
  assert.deepEqual(decodePatchText("\uFEFF").lines, []);
  assert.deepEqual(decodePatchText("a\n\uFEFFb").lines, ["a", "\uFEFFb"]);
});

test("UTF-8 decoding rejects malformed bytes without confusing literal replacement characters", () => {
  for (const bytes of [[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80]]) {
    assert.throws(() => decodeFileText(Uint8Array.from(bytes)), /valid UTF-8/);
  }
  assert.equal(decodeFileText(Buffer.from("\uFEFFa\uFFFD")), "\uFEFFa\uFFFD");
  assert.throws(() => decodePatchText("\ud800"), /well-formed/);
});

test("decode and encode preserve every original line terminator and BOM", () => {
  for (const content of ["", "\uFEFF", "a\r\nb\nc\r\n", "\uFEFFa\nb\r\nc", "\n\r\n", "a\r"]) {
    const source = decodePatchText(content);
    assert.equal(encodePatchText(source), content);
    assert.equal(source.endings.length, source.lines.length);
  }
  assert.equal(decodePatchText("a\r\nb\n").textFormat.lineEnding, "mixed");
  assert.throws(() => encodePatchText({ lines: ["a"], endings: [] }), /terminators/);
});
