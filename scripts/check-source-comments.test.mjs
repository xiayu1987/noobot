/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findForbiddenComments } from "./quality/source-comments.mjs";

const LICENSE_HEADER = `/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
`;

test("reports every explanatory comment, including duplicates", () => {
  const comments = findForbiddenComments("// note\nconst value = 1;\n// note\n", "a.js");
  assert.deepEqual(
    comments.map((comment) => comment.loc.start.line),
    [1, 3],
  );
});

test("reports Vue template comments", () => {
  assert.equal(
    findForbiddenComments("<template><!-- detail --><span /></template>\n", "a.vue").length,
    1,
  );
});

test("reports style and shell comments by file type", () => {
  assert.equal(findForbiddenComments("a { color: red; } /* why */\n", "a.css").length, 1);
  assert.equal(findForbiddenComments("#!/bin/sh\n# why\necho ok\n", "a.sh").length, 1);
});

test("allows the license header and a shebang", () => {
  assert.equal(findForbiddenComments(`${LICENSE_HEADER}const value = 1;\n`, "a.js").length, 0);
  assert.equal(findForbiddenComments("#!/usr/bin/env node\nconst value = 1;\n", "a.mjs").length, 0);
});
