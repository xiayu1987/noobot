#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCoAuthorTrailers } from "./check-commit-message.mjs";

const OWNER_EMAILS = new Set([
  "126240622+xiayu1987@users.noreply.github.com",
  "xiayu19870430@gmail.com",
]);
const OWNER_NAMES = new Set(["xiayu", "xiayu1987"]);

export function validateIdentity(name, email) {
  return OWNER_NAMES.has(name) && OWNER_EMAILS.has(email);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function checkCurrent() {
  for (const role of ["AUTHOR", "COMMITTER"]) {
    const identity = git("var", `GIT_${role}_IDENT`);
    const match = /^(.*) <([^<>]+)> \d+ [+-]\d+$/.exec(identity);
    if (!match || !validateIdentity(match[1], match[2])) {
      throw new Error(`Unapproved ${role.toLowerCase()}: ${identity}`);
    }
  }
}

function checkRange(...revisions) {
  const fields = git(
    "log",
    "-z",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B",
    ...revisions,
  ).split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 6 !== 0) throw new Error("Invalid git log identity record");
  for (let index = 0; index < fields.length; index += 6) {
    const [sha, author, authorEmail, committer, committerEmail, body] = fields.slice(
      index,
      index + 6,
    );
    if (!validateIdentity(author, authorEmail) || !validateIdentity(committer, committerEmail)) {
      throw new Error(
        `Unapproved commit identity: ${sha}: ${author} <${authorEmail}> / ${committer} <${committerEmail}>`,
      );
    }
    if (findCoAuthorTrailers(body).length) throw new Error(`Co-Authored-By is forbidden: ${sha}`);
  }
}

function checkPush() {
  for (const line of fs.readFileSync(0, "utf8").trim().split("\n")) {
    if (!line) continue;
    const match = /^\S+ (?<local>[a-f0-9]+) \S+ (?<remote>[a-f0-9]+)$/.exec(line);
    if (!match) throw new Error("Invalid pre-push revision record");
    const { local, remote } = match.groups;
    if (/^0+$/.test(local)) continue;
    if (/^0+$/.test(remote)) checkRange(local, "--not", "--remotes");
    else checkRange(`${remote}..${local}`);
  }
}

function main() {
  const [mode, revision] = process.argv.slice(2);
  if (mode === "--current") return checkCurrent();
  if (mode === "--range" && revision) return checkRange(revision);
  if (mode === "--pre-push") return checkPush();
  throw new Error("usage: check-commit-identity.mjs --current | --range <revision> | --pre-push");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`commit identity: ${error.message}\n`);
    process.exitCode = 1;
  }
}
