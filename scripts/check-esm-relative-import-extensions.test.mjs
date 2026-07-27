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
import { checkRepository, inspectSourceFile } from "./check-esm-relative-import-extensions.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-esm-extensions-"));
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return root;
}

test("finds parser-recognized extensionless imports without matching comments or packages", async () => {
  const root = fixture({
    "src/main.js": [
      'import value from "./value";',
      'export * from "./helpers";',
      'const lazy = import("./lazy?raw");',
      'import vue from "vue";',
      '// import ignored from "./comment";',
    ].join("\n"),
    "src/value.js": "export default 1;\n",
    "src/helpers/index.js": "export const helper = true;\n",
    "src/lazy.js": "export default 2;\n",
  });
  const result = await checkRepository({ root, sourceRoots: ["src"] });
  assert.deepEqual(result.violations.map(({ specifier, replacement }) => [specifier, replacement]), [
    ["./value", "./value.js"],
    ["./helpers", "./helpers/index.js"],
    ["./lazy?raw", "./lazy.js?raw"],
  ]);
});

test("fixes only uniquely resolved imports and preserves quote style", async () => {
  const root = fixture({
    "src/main.js": "import './side-effect';\nconst lazy = import(\"./lazy#worker\");\n",
    "src/side-effect.js": "export {};\n",
    "src/lazy.mjs": "export {};\n",
  });
  const result = await checkRepository({ root, fix: true, sourceRoots: ["src"] });
  assert.equal(result.fixed, 2);
  assert.deepEqual(result.violations, []);
  assert.equal(
    fs.readFileSync(path.join(root, "src/main.js"), "utf8"),
    "import './side-effect.js';\nconst lazy = import(\"./lazy.mjs#worker\");\n",
  );
});

test("parses Vue script blocks and resolves Vue components by their real extension", async () => {
  const root = fixture({
    "src/App.vue": [
      "<template><Widget /></template>",
      "<script setup>",
      'import Widget from "./Widget";',
      "</script>",
    ].join("\n"),
    "src/Widget.vue": "<template><p>Widget</p></template>\n",
  });
  const result = await checkRepository({ root, fix: true, sourceRoots: ["src"] });
  assert.equal(result.fixed, 1);
  assert.match(fs.readFileSync(path.join(root, "src/App.vue"), "utf8"), /from "\.\/Widget\.vue"/);
});

test("reports ambiguous, missing, and computed relative targets without guessing", async () => {
  const root = fixture({
    "src/main.js": [
      'import value from "./value";',
      'import missing from "./missing";',
      "const computed = import(`./locales/${locale}`);",
    ].join("\n"),
    "src/value.js": "export default 1;\n",
    "src/value.vue": "<template />\n",
  });
  const file = path.join(root, "src/main.js");
  const violations = await inspectSourceFile(file);
  assert.deepEqual(violations.map(({ reason, replacement }) => [reason, replacement]), [
    ["ambiguous target (value.js, value.vue)", null],
    ["target not found", null],
    ["computed relative import has no explicit extension", null],
  ]);
});

test("accepts explicit extensions including dynamic template suffixes", async () => {
  const root = fixture({
    "src/main.js": [
      'import value from "./value.js";',
      "const locale = import(`./locales/${name}.js`);",
    ].join("\n"),
  });
  assert.deepEqual(await inspectSourceFile(path.join(root, "src/main.js")), []);
});
