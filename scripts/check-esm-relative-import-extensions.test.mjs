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
import { measureEsmRelativeImportExtensions } from "./check-esm-relative-import-extensions.mjs";
import { fixEsmRelativeImportExtensions } from "./fix-esm-relative-import-extensions.mjs";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-esm-extensions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return root;
}

function samples(measured) {
  return Object.fromEntries(
    Object.entries(measured)
      .filter(([, measurement]) => measurement.total)
      .map(([rule, measurement]) => [rule, measurement.samples]),
  );
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("finds parser-recognized extensionless imports without matching comments or packages", async (t) => {
  const root = fixture(t, {
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
  assert.deepEqual(samples(await measureEsmRelativeImportExtensions(root, ["src/main.js"])), {
    missingExtension: [
      'src/main.js:1 "./value"',
      'src/main.js:2 "./helpers"',
      'src/main.js:3 "./lazy?raw"',
    ],
  });
});

test("reports ambiguous, missing, computed, and unparsable sources without guessing", async (t) => {
  const root = fixture(t, {
    "src/main.js": [
      'import value from "./value";',
      'import missing from "./missing";',
      "const computed = import(`./locales/${locale}`);",
    ].join("\n"),
    "src/value.js": "export default 1;\n",
    "src/value.vue": "<template />\n",
    "src/broken.js": "import { from './x.js';\n",
  });
  const { unanalyzableSource, ...rest } = samples(
    await measureEsmRelativeImportExtensions(root, ["src/main.js", "src/broken.js"]),
  );
  assert.deepEqual(rest, {
    ambiguousTarget: ['src/main.js:1 "./value (value.js, value.vue)"'],
    targetNotFound: ['src/main.js:2 "./missing"'],
    computedRelativeImport: ['src/main.js:3 "./locales/${locale}"'],
  });
  assert.equal(unanalyzableSource.length, 1);
  assert.match(unanalyzableSource[0], /^src\/broken\.js:2 "module parse failed: /);
});

test("accepts explicit extensions including dynamic template suffixes", async (t) => {
  const root = fixture(t, {
    "src/main.js": [
      'import value from "./value.js";',
      "const locale = import(`./locales/${name}.js`);",
    ].join("\n"),
  });
  assert.deepEqual(samples(await measureEsmRelativeImportExtensions(root, ["src/main.js"])), {});
});

test("fix rewrites only uniquely resolved imports and preserves quote style", async (t) => {
  const root = fixture(t, {
    "src/main.js": "import './side-effect';\nconst lazy = import(\"./lazy#worker\");\n",
    "src/side-effect.js": "export {};\n",
    "src/lazy.mjs": "export {};\n",
    "src/ambiguous.js": 'import value from "./value";\n',
    "src/value.js": "export default 1;\n",
    "src/value.vue": "<template />\n",
  });
  assert.equal(await fixEsmRelativeImportExtensions(root, ["src/main.js", "src/ambiguous.js"]), 2);
  assert.equal(
    read(root, "src/main.js"),
    "import './side-effect.js';\nconst lazy = import(\"./lazy.mjs#worker\");\n",
  );
  assert.equal(read(root, "src/ambiguous.js"), 'import value from "./value";\n');
});

test("fix resolves imports in classic and setup Vue script blocks", async (t) => {
  const root = fixture(t, {
    "src/App.vue": [
      '<script>import classic from "./classic";</script>',
      '<script setup>import Widget from "./Widget";</script>',
    ].join("\n"),
    "src/classic.js": "export default 1;\n",
    "src/Widget.vue": "<template><p>Widget</p></template>\n",
  });
  assert.equal(await fixEsmRelativeImportExtensions(root, ["src/App.vue"]), 2);
  const output = read(root, "src/App.vue");
  assert.match(output, /from "\.\/classic\.js"/);
  assert.match(output, /from "\.\/Widget\.vue"/);
  assert.deepEqual(samples(await measureEsmRelativeImportExtensions(root, ["src/App.vue"])), {});
});
