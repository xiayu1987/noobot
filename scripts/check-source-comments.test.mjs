/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findAddedSourceComments } from "./check-source-comments.mjs";

test("source comment guard detects newly added comments", () => {
  const comments = findAddedSourceComments(
    "const value = 1;\n",
    "const value = 1;\n// explanation\n",
  );
  assert.equal(comments.length, 1);
});

test("source comment guard counts duplicate comments instead of deduplicating them", () => {
  const comments = findAddedSourceComments(
    "// explanation\nconst value = 1;\n",
    "// explanation\nconst value = 1;\n// explanation\n",
  );
  assert.equal(comments.length, 1);
});

test("source comment guard detects Vue template comments", () => {
  const comments = findAddedSourceComments(
    "<template><span /></template>\n",
    "<template><!-- detail --><span /></template>\n",
  );
  assert.equal(comments.length, 1);
});

test("source comment guard allows the required license header", () => {
  const source = `/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const value = 1;
`;
  assert.equal(findAddedSourceComments("const value = 1;\n", source).length, 0);
});

test("source comment guard allows a shebang", () => {
  const source = "#!/usr/bin/env node\nconst value = 1;\n";
  assert.equal(findAddedSourceComments("const value = 1;\n", source).length, 0);
});
