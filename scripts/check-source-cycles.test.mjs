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
import { measureSourceCycles } from "./check-source-cycles.mjs";

function withModules(t, modules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-source-cycles-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(modules)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}

test("source cycles reports each relative import ring once in canonical order", async (t) => {
  const modules = {
    "src/b.js": `import "./a.js";\n`,
    "src/a.js": `export * from "./b.js";\nimport "node:path";\n`,
    "src/leaf/index.js": `export const leaf = 1;\n`,
    "src/c.mjs": `import { leaf } from "./leaf/index.js";\nexport { leaf };\n`,
  };
  const measured = await measureSourceCycles(withModules(t, modules), Object.keys(modules));
  assert.deepEqual(measured.importCycle.samples, ["src/a.js src/a.js -> src/b.js -> src/a.js"]);
});

test("source cycles ignores imports that resolve outside the scanned module set", async (t) => {
  const modules = { "src/a.js": `import "./b.js";\n`, "src/b.js": `import "./a.js";\n` };
  const measured = await measureSourceCycles(withModules(t, modules), ["src/a.js"]);
  assert.equal(measured.importCycle.total, 0);
});
