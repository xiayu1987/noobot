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
import { measureBarrelStarExports } from "./check-barrel-star-exports.mjs";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-barrel-star-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return { root, files: Object.keys(files).filter((file) => file.endsWith(".js")) };
}

async function dropped(project) {
  const { droppedStarExport } = await measureBarrelStarExports(project.root, project.files);
  return droppedStarExport.samples;
}

test("reports symbols dropped when two star sources own the same name", async (t) => {
  const project = fixture(t, {
    "src/index.js": ['export * from "./left.js";', 'export * from "./right.js";'].join("\n"),
    "src/left.js": "export const shared = 1;\nexport const onlyLeft = 2;\n",
    "src/right.js": "export const shared = 3;\nexport const onlyRight = 4;\n",
  });
  assert.deepEqual(await dropped(project), [
    "src/index.js shared exported by ./left.js and ./right.js",
  ]);
});

test("accepts a collision resolved by an explicit re-export", async (t) => {
  const project = fixture(t, {
    "src/index.js": [
      'export * from "./left.js";',
      'export * from "./right.js";',
      'export { shared } from "./left.js";',
    ].join("\n"),
    "src/left.js": "export const shared = 1;\n",
    "src/right.js": "export const shared = 3;\n",
  });
  assert.deepEqual(await dropped(project), []);
});

test("accepts disjoint star sources", async (t) => {
  const project = fixture(t, {
    "src/index.js": ['export * from "./left.js";', 'export * from "./right.js";'].join("\n"),
    "src/left.js": "export const onlyLeft = 1;\n",
    "src/right.js": "export const onlyRight = 2;\n",
  });
  assert.deepEqual(await dropped(project), []);
});

test("analyzes a barrel whose source has named Vue component re-exports", async (t) => {
  const project = fixture(t, {
    "src/index.js": ['export * from "./ui.js";', 'export * from "./domain.js";'].join("\n"),
    "src/ui.js": 'export { default as Widget } from "./Widget.vue";\n',
    "src/domain.js": "export const value = 1;\n",
    "src/Widget.vue": "<template><div /></template>\n",
  });
  assert.deepEqual(await dropped(project), []);
});

test("fails when a star-export source cannot be analyzed", async (t) => {
  const project = fixture(t, {
    "src/index.js": ['export * from "./broken.js";', 'export * from "./valid.js";'].join("\n"),
    "src/broken.js": "export const = ;\n",
    "src/valid.js": "export const value = 1;\n",
  });
  await assert.rejects(dropped(project), /unable to analyze/);
});

test("analyzes exports without executing repository modules", async (t) => {
  const project = fixture(t, {
    "src/index.js": ['export * from "./left.js";', 'export * from "./right.js";'].join("\n"),
    "src/left.js":
      'import fs from "node:fs";\nfs.writeFileSync(new URL("../executed", import.meta.url), "yes");\nexport const left = 1;\n',
    "src/right.js": "export const right = 2;\n",
  });
  assert.deepEqual(await dropped(project), []);
  assert.equal(fs.existsSync(path.join(project.root, "executed")), false);
});

test("propagates recursive namespaces while excluding unresolved nested collisions", async (t) => {
  const project = fixture(t, {
    "src/index.js": 'export * from "./nested.js";\nexport * from "./right.js";\n',
    "src/nested.js": 'export * from "./left.js";\nexport * from "./other.js";\n',
    "src/left.js": "export const hidden = 1;\nexport const shared = 2;\n",
    "src/other.js": "export const hidden = 3;\n",
    "src/right.js": "export const shared = 4;\nexport const hidden = 5;\n",
  });
  assert.deepEqual(await dropped(project), [
    "src/index.js shared exported by ./nested.js and ./right.js",
    "src/nested.js hidden exported by ./left.js and ./other.js",
  ]);
});

test("rejects circular star sources instead of returning a partial namespace", async (t) => {
  const project = fixture(t, {
    "src/index.js": 'export * from "./loop.js";\nexport * from "./value.js";\n',
    "src/loop.js": 'export * from "./index.js";\n',
    "src/value.js": "export const value = 1;\n",
  });
  await assert.rejects(dropped(project), /circular star export cannot be analyzed/);
});
