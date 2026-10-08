/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { replaceJsonVersion } from "./bump-version.mjs";

test("version bump keeps the original JSON layout", () => {
  const source = [
    "{",
    '  "name": "demo",',
    '  "version": "1.0.0",',
    '  "preferences": {',
    '    "profile": {',
    '      "planning": { "enabled": false }',
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const nextSource = replaceJsonVersion(source, "1.0.1");
  assert.equal(nextSource, source.replace('"1.0.0"', '"1.0.1"'));
});

test("version bump only replaces the top-level version field", () => {
  const source = '{\n  "version": "1.0.0",\n  "dependencies": { "dep": "1.0.0" }\n}\n';
  const nextSource = replaceJsonVersion(source, "2.0.0");
  assert.deepEqual(JSON.parse(nextSource), {
    version: "2.0.0",
    dependencies: { dep: "1.0.0" },
  });
});

test("version bump rejects files without a version field", () => {
  assert.throws(() => replaceJsonVersion('{\n  "name": "demo"\n}\n', "1.0.1"), /version field/);
});

test("version bump skips nested version fields declared before the top-level one", () => {
  const source = '{\n  "meta": {\n    "version": "0.1.0"\n  },\n  "version": "1.0.0"\n}\n';
  assert.deepEqual(JSON.parse(replaceJsonVersion(source, "1.0.1")), {
    meta: { version: "0.1.0" },
    version: "1.0.1",
  });
});
