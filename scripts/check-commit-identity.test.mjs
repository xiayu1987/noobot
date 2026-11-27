/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateIdentity } from "./check-commit-identity.mjs";

const script = fileURLToPath(new URL("./check-commit-identity.mjs", import.meta.url));
const hooks = fileURLToPath(new URL("../hooks", import.meta.url));
const owner = {
  ...process.env,
  GIT_AUTHOR_NAME: "xiayu",
  GIT_AUTHOR_EMAIL: "126240622+xiayu1987@users.noreply.github.com",
  GIT_COMMITTER_NAME: "xiayu",
  GIT_COMMITTER_EMAIL: "126240622+xiayu1987@users.noreply.github.com",
};

function repository(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "commit-identity-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, env: owner, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  return { cwd, git };
}

function check(cwd, args, env = owner, input) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, input, encoding: "utf8" });
}

test("identity policy accepts owner identities and rejects unrelated names or emails", () => {
  assert.equal(validateIdentity("xiayu", owner.GIT_AUTHOR_EMAIL), true);
  assert.equal(validateIdentity("xiayu1987", "xiayu19870430@gmail.com"), true);
  assert.equal(validateIdentity("Codex", "codex@openai.com"), false);
  assert.equal(validateIdentity("Claude", "noreply@anthropic.com"), false);
  assert.equal(validateIdentity("xiayu", "codex@openai.com"), false);
  assert.equal(validateIdentity("Codex", owner.GIT_AUTHOR_EMAIL), false);
});

test("current identity checks author and committer independently", (t) => {
  const { cwd } = repository(t);
  assert.equal(check(cwd, ["--current"]).status, 0);
  for (const role of ["AUTHOR", "COMMITTER"]) {
    const env = { ...owner, [`GIT_${role}_EMAIL`]: "codex@openai.com" };
    assert.equal(check(cwd, ["--current"], env).status, 1);
  }
});

test("range and push checks reject recorded identities and co-authors", (t) => {
  const { cwd, git } = repository(t);
  git("commit", "--allow-empty", "-m", "owner baseline");
  const base = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-m", "owner change");
  assert.equal(check(cwd, ["--range", `${base}..HEAD`]).status, 0);
  git("commit", "--allow-empty", "--author", "Codex <codex@openai.com>", "-m", "bad author");
  const head = git("rev-parse", "HEAD");
  assert.equal(check(cwd, ["--range", `${base}..HEAD`]).status, 1);
  assert.equal(
    check(cwd, ["--pre-push"], owner, `refs/heads/main ${head} refs/heads/main ${base}\n`).status,
    1,
  );
  assert.equal(
    check(cwd, ["--pre-push"], owner, `refs/heads/main ${"0".repeat(40)} refs/heads/main ${head}\n`)
      .status,
    0,
  );
  git(
    "commit",
    "--allow-empty",
    "-m",
    "bad trailer\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
  );
  assert.equal(check(cwd, ["--range", "HEAD^..HEAD"]).status, 1);
  assert.equal(check(cwd, ["--range", "missing-ref..HEAD"]).status, 1);
});

test("installed hooks block bad author, bad committer and co-author at actual commit time", (t) => {
  const { cwd, git } = repository(t);
  mkdirSync(path.join(cwd, "scripts"));
  for (const name of ["check-commit-identity.mjs", "check-commit-message.mjs"]) {
    copyFileSync(new URL(`./${name}`, import.meta.url), path.join(cwd, "scripts", name));
  }
  git("config", "core.hooksPath", hooks);
  for (const args of [
    ["--author", "Codex <codex@openai.com>", "-m", "bad author"],
    ["-m", "bad trailer\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
  ]) {
    const result = spawnSync("git", ["commit", "--allow-empty", ...args], {
      cwd,
      env: owner,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stdout);
  }
  const result = spawnSync("git", ["commit", "--allow-empty", "-m", "bad committer"], {
    cwd,
    env: { ...owner, GIT_COMMITTER_EMAIL: "codex@openai.com" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, result.stdout);
  git("commit", "--allow-empty", "-m", "owner accepted");
});
