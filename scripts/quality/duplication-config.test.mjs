/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mergeDuplicationIgnoreGlobs } from "./duplication-config.mjs";

test("duplication ignore rules retain configured file types and source exclusions", () => {
  assert.deepEqual(
    mergeDuplicationIgnoreGlobs(
      ["**/*.md", "**/node_modules/**"],
      ["**/generated/**", "**/node_modules/**"],
    ),
    ["**/*.md", "**/node_modules/**", "**/generated/**"],
  );
});
