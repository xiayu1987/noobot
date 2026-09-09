/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRepository, collectBarrels } from "./check-barrel-star-exports.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-barrel-star-"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return root;
}

test("reports symbols dropped when two star sources own the same name", async () => {
  const root = fixture({
    "src/index.js": ['export * from "./left.js";', 'export * from "./right.js";'].join("\n"),
    "src/left.js": "export const shared = 1;\nexport const onlyLeft = 2;\n",
    "src/right.js": "export const shared = 3;\nexport const onlyRight = 4;\n",
  });
  const { violations } = await checkRepository({ root });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].relative, path.join("src", "index.js"));
  assert.deepEqual(
    violations[0].dropped.map(({ name, sources }) => [name, sources]),
    [["shared", ["./left.js", "./right.js"]]],
  );
});

test("accepts a collision resolved by an explicit re-export", async () => {
  const root = fixture({
    "src/index.js": [
      'export * from "./left.js";',
      'export * from "./right.js";',
      'export { shared } from "./left.js";',
    ].join("\n"),
    "src/left.js": "export const shared = 1;\n",
    "src/right.js": "export const shared = 3;\n",
  });
  const { violations } = await checkRepository({ root });
  assert.deepEqual(violations, []);
});

test("accepts disjoint star sources", async () => {
  const root = fixture({
    "src/index.js": ['export * from "./left.js";', 'export * from "./right.js";'].join("\n"),
    "src/left.js": "export const onlyLeft = 1;\n",
    "src/right.js": "export const onlyRight = 2;\n",
  });
  const { violations } = await checkRepository({ root });
  assert.deepEqual(violations, []);
});

test("analyzes a barrel whose source has named Vue component re-exports", async () => {
  const root = fixture({
    "src/index.js": ['export * from "./ui.js";', 'export * from "./domain.js";'].join("\n"),
    "src/ui.js": 'export { default as Widget } from "./Widget.vue";\n',
    "src/domain.js": "export const value = 1;\n",
    "src/Widget.vue": "<template><div /></template>\n",
  });
  const { violations } = await checkRepository({ root });
  assert.deepEqual(violations, []);
});

test("fails when a star-export source cannot be analyzed", async () => {
  const root = fixture({
    "src/index.js": ['export * from "./broken.js";', 'export * from "./valid.js";'].join("\n"),
    "src/broken.js": "export const = ;\n",
    "src/valid.js": "export const value = 1;\n",
  });
  await assert.rejects(checkRepository({ root }), /unable to analyze/);
});

test("collects only files with at least two star re-exports and skips ignored directories", () => {
  const root = fixture({
    "src/index.js": ['export * from "./a.js";', 'export * from "./b.js";'].join("\n"),
    "src/single.js": 'export * from "./a.js";\n',
    "src/a.js": "export const a = 1;\n",
    "src/b.js": "export const b = 2;\n",
    "dist/index.js": ['export * from "./a.js";', 'export * from "./b.js";'].join("\n"),
  });
  const barrels = collectBarrels({ root });
  assert.deepEqual(
    barrels.map((barrel) => barrel.relative),
    [path.join("src", "index.js")],
  );
});
