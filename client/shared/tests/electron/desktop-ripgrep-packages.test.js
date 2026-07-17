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

test("desktop backend runtime selects the Windows ripgrep binary for the build architecture", () => {
  for (const [arch, packageName] of [
    ["x64", "@vscode/ripgrep-win32-x64"],
    ["arm64", "@vscode/ripgrep-win32-arm64"],
    ["ia32", "@vscode/ripgrep-win32-ia32"],
  ]) {
    const packages = getDesktopRipgrepPackages("noobot-windows-client", version, arch);
    assert.deepEqual(packages, [`${packageName}@${version}`]);
    assert.equal(getRipgrepBinaryRelativePath(packages[0]), `node_modules/${packageName}/bin/rg.exe`);
  }
});

test("desktop backend runtime selects the macOS ripgrep binary for the build architecture", () => {
  for (const [arch, packageName] of [
    ["x64", "@vscode/ripgrep-darwin-x64"],
    ["arm64", "@vscode/ripgrep-darwin-arm64"],
  ]) {
    const packages = getDesktopRipgrepPackages("noobot-mac-client", version, arch);
    assert.deepEqual(packages, [`${packageName}@${version}`]);
    assert.equal(getRipgrepBinaryRelativePath(packages[0]), `node_modules/${packageName}/bin/rg`);
  }
});

test("unsupported package and architecture combinations do not request a binary", () => {
  assert.deepEqual(getDesktopRipgrepPackages("noobot-chat", version, "x64"), []);
  assert.deepEqual(getDesktopRipgrepPackages("noobot-mac-client", version, "ia32"), []);
});
