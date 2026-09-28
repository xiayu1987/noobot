/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as syntax from "@noobot/path-resolver/syntax";
import * as resolver from "@noobot/path-resolver";

test("browser and runtime entrypoints share the same path syntax implementation", () => {
  for (const [name, implementation] of Object.entries(syntax)) {
    assert.equal(resolver[name], implementation, name);
  }
});

test("absolute path syntax distinguishes drive paths from URI schemes", () => {
  for (const path of [
    "C:/Users/xiayu/AppData/Roaming/Noobot/workspace/xiayu/tool_test/session-d3193767/smoke.txt",
    "c:\\Users\\xiayu\\workspace\\report.md",
    "/Users/xiayu/workspace/report.md",
    "/home/xiayu/workspace/report.md",
  ]) {
    assert.equal(syntax.isAbsolutePathForPlatform(path), true, path);
  }
  for (const uri of [
    "https://example.com/report.md",
    "mailto:xiayu@example.com",
    "attachment:v1:session/model/file",
    "output://report.md",
    "c:relative.txt",
    "runtime/report.md",
  ]) {
    assert.equal(syntax.isAbsolutePathForPlatform(uri), false, uri);
  }
});
