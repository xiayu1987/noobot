/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { PATH_REF_VIEWS } from "@noobot/path-resolver";
import { projectToolPathRef } from "../../src/tools/core/check-tool-input.js";
import { MEMORY_RELATIVE_PATHS } from "../../src/memory/storage/paths.js";

function isAbsoluteAnyPlatform(value) {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(String(value || ""));
}

test("memory relative paths stay relative and never carry a drive or root prefix", () => {
  const entries = Object.entries(MEMORY_RELATIVE_PATHS);
  assert.ok(entries.length > 0);
  for (const [field, relativePath] of entries) {
    assert.equal(typeof relativePath, "string", `${field} must be a string`);
    assert.ok(relativePath.trim(), `${field} must not be blank`);
    assert.equal(
      isAbsoluteAnyPlatform(relativePath),
      false,
      `${field} must stay workspace relative`,
    );
  }
});

test("help memory paths project through the resolver as workspace path refs", () => {
  for (const [field, relativePath] of Object.entries(MEMORY_RELATIVE_PATHS)) {
    const projected = projectToolPathRef(relativePath);
    assert.equal(projected.view, PATH_REF_VIEWS.WORKSPACE, `${field} must project as workspace`);
    assert.equal(
      isAbsoluteAnyPlatform(projected.path),
      false,
      `${field} must not expose a host absolute path`,
    );
    assert.equal(projected.path, relativePath, `${field} must round-trip its logical path`);
    assert.equal(Object.isFrozen(projected), true, `${field} must project a frozen path ref`);
  }
});
