/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  getDesktopRipgrepPackages,
  getRipgrepBinaryRelativePath,
} from "../../scripts/desktop-ripgrep-packages.mjs";

const version = "^1.18.0";

test("desktop backend runtime includes every supported Windows ripgrep binary", () => {
  const packages = getDesktopRipgrepPackages("noobot-windows-client", version);
  assert.deepEqual(packages, [
    `@vscode/ripgrep-win32-x64@${version}`,
    `@vscode/ripgrep-win32-arm64@${version}`,
    `@vscode/ripgrep-win32-ia32@${version}`,
  ]);
  assert.deepEqual(packages.map(getRipgrepBinaryRelativePath), [
    "node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe",
    "node_modules/@vscode/ripgrep-win32-arm64/bin/rg.exe",
    "node_modules/@vscode/ripgrep-win32-ia32/bin/rg.exe",
  ]);
});

test("desktop backend runtime includes both supported macOS ripgrep binaries", () => {
  const packages = getDesktopRipgrepPackages("noobot-mac-client", version);
  assert.deepEqual(packages, [
    `@vscode/ripgrep-darwin-x64@${version}`,
    `@vscode/ripgrep-darwin-arm64@${version}`,
  ]);
  assert.deepEqual(packages.map(getRipgrepBinaryRelativePath), [
    "node_modules/@vscode/ripgrep-darwin-x64/bin/rg",
    "node_modules/@vscode/ripgrep-darwin-arm64/bin/rg",
  ]);
});

test("non-desktop packages do not request platform ripgrep binaries", () => {
  assert.deepEqual(getDesktopRipgrepPackages("noobot-chat", version), []);
});
