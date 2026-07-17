/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { directPathModulePattern } from "./check-bare-file-paths.mjs";

function isRejected(source) {
  directPathModulePattern.lastIndex = 0;
  return directPathModulePattern.test(source);
}

test("rejects every supported direct Node path module form", () => {
  for (const source of [
    'import path from "node:path";',
    'import { join as pathJoin } from "path";',
    'const path = require("node:path");',
    'const posix = require("node:path/posix");',
    'const win32 = await import("path/win32");',
  ]) assert.equal(isRejected(source), true, source);
});

test("does not reject resolver imports or incidental strings", () => {
  for (const source of [
    'import path from "../shared/path-resolver.js";',
    'const message = "use node:path through the resolver";',
    '// import path from a project module',
  ]) assert.equal(isRejected(source), false, source);
});
