/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  escapesDirectory,
  importReferences,
  matchingLineHits,
  offsetLine,
  repositoryPathExists,
} from "./repository-files.mjs";

test("repositoryPathExists reports missing paths and rethrows other access errors", async () => {
  assert.equal(await repositoryPathExists("package.json"), true);
  assert.equal(await repositoryPathExists("zz-missing-quality-probe"), false);
  await assert.rejects(repositoryPathExists("package.json/child"), { code: "ENOTDIR" });
});

test("matchingLineHits reports one-based line numbers for every matching line", () => {
  const source = "alpha\r\nbeta\nalpha beta\n";
  assert.deepEqual(
    matchingLineHits("a.js", source, (text) => text.includes("alpha"), "hit"),
    [
      { file: "a.js", line: 1, message: "hit" },
      { file: "a.js", line: 3, message: "hit" },
    ],
  );
});

test("offsetLine maps a character offset to its one-based line", () => {
  const source = "a\nbb\nccc";
  assert.equal(offsetLine(source, 0), 1);
  assert.equal(offsetLine(source, source.indexOf("bb")), 2);
  assert.equal(offsetLine(source, source.indexOf("ccc")), 3);
});

test("importReferences returns static, side-effect, dynamic and require specifiers with lines", () => {
  const source = [
    'import a from "./a.js";',
    "import {",
    "  b,",
    "} from '../b.js';",
    'export { c } from "node:fs";',
    'import "./side-effect.js";',
    'const d = await import("./dynamic.js");',
    "const e = require('./required.cjs');",
    "const notImport = reimport('x');",
  ].join("\n");
  assert.deepEqual(importReferences(source), [
    { specifier: "./a.js", line: 1 },
    { specifier: "../b.js", line: 4 },
    { specifier: "node:fs", line: 5 },
    { specifier: "./side-effect.js", line: 6 },
    { specifier: "./dynamic.js", line: 7 },
    { specifier: "./required.cjs", line: 8 },
  ]);
});

test("escapesDirectory resolves relative specifiers against the directory boundary", () => {
  const file = "memory-protocol/src/lib/a.js";
  const directory = "memory-protocol/src";
  assert.equal(escapesDirectory(file, directory, "./b.js"), false);
  assert.equal(escapesDirectory(file, directory, "../c.js"), false);
  assert.equal(escapesDirectory(file, directory, "node:fs"), false);
  assert.equal(escapesDirectory(file, directory, "@noobot/agent"), false);
  assert.equal(escapesDirectory(file, directory, "../../package.json"), true);
  assert.equal(escapesDirectory(file, directory, "../.."), true);
  assert.equal(escapesDirectory(file, directory, "../../../agent/src/x.js"), true);
});

test("escapesDirectory treats a same-prefix sibling directory as outside the boundary", () => {
  assert.equal(
    escapesDirectory("memory-protocol/src/a.js", "memory-protocol/src", "../src-x/b.js"),
    true,
  );
  assert.equal(
    escapesDirectory("foo-protocol/a.js", "foo-protocol", "../foo-protocol-x/b.js"),
    true,
  );
});
