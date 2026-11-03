/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const release = fileURLToPath(new URL("./release.mjs", import.meta.url));

function probe(cwd, args) {
  return spawnSync(process.execPath, [release, "4.4.3", "--dry-run", "--skip-push", ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("release rejects remote options and URLs before invoking Git", () => {
  for (const remote of [
    "--upload-pack=malicious",
    "-origin",
    "ext::malicious",
    "https://host/repo",
  ]) {
    const child = probe(os.tmpdir(), ["--remote", remote]);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /--remote must be a remote name/);
  }
});

test("release checks a named local remote and validates branch names without publishing", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "noobot-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const working = path.join(root, "working");
  for (const args of [
    ["init", "--bare", remote],
    ["init", "--initial-branch=main", working],
    ["-C", working, "remote", "add", "origin", remote],
  ]) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const valid = probe(working, []);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /\[release\] v4\.4\.3 is ready/);
  assert.match(valid.stdout, /\[dry-run\] git tag v4\.4\.3/);
  for (const branch of ["--upload-pack=malicious", "invalid..branch"]) {
    const child = probe(working, ["--branch", branch]);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /check-ref-format/);
  }
  const tags = spawnSync("git", ["-C", working, "tag", "--list"], { encoding: "utf8" });
  assert.equal(tags.status, 0, tags.stderr);
  assert.equal(tags.stdout, "");
});
