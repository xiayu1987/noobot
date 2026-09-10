#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bumpVersion, normalizeVersion, assertVersion, run } from "./bump-version.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv = []) {
  const args = {
    version: "",
    remote: "origin",
    branch: "",
    dryRun: false,
    skipPush: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (value === "--skip-push") {
      args.skipPush = true;
      continue;
    }
    if (value === "--remote") {
      args.remote = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--branch") {
      args.branch = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (!args.version) {
      args.version = value;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  args.version = normalizeVersion(args.version);
  assertVersion(args.version);
  if (!args.remote) throw new Error("--remote cannot be empty");
  return args;
}

async function gitOutput(args = []) {
  const { stdout } = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function assertCleanWorkingTree() {
  const status = await gitOutput(["status", "--porcelain"]);
  if (status) {
    throw new Error(
      ["Working tree is not clean. Commit or stash existing changes before release.", status].join(
        "\n",
      ),
    );
  }
}

async function assertTagDoesNotExist(tagName = "", remote = "origin") {
  const existingTag = await gitOutput(["tag", "--list", tagName]);
  if (existingTag) throw new Error(`Tag ${tagName} already exists locally.`);
  try {
    await execFileAsync("git", ["ls-remote", "--exit-code", "--tags", remote, tagName], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    throw new Error(`Tag ${tagName} already exists on ${remote}.`);
  } catch (error) {
    if (error?.code === 2) return;
    throw error;
  }
}

async function resolveBranch(explicitBranch = "") {
  if (explicitBranch) return explicitBranch;
  const branch = await gitOutput(["branch", "--show-current"]);
  if (!branch) throw new Error("Could not resolve current branch. Pass --branch <name>.");
  return branch;
}

async function runOrPrint(command, args, { dryRun = false } = {}) {
  const display = [command, ...args].join(" ");
  if (dryRun) {
    console.log(`[release][dry-run] ${display}`);
    return;
  }
  await run(command, args);
}

async function waitForRemoteQuality(branch, commit, { remote = "origin", dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[release][dry-run] wait for Quality Checks on ${remote}/${branch} at ${commit}`);
    return;
  }
  const remoteUrl = await gitOutput(["remote", "get-url", remote]);
  if (!/^git@github\.com:|^https:\/\/github\.com\//.test(remoteUrl)) {
    throw new Error(`Remote quality gate requires a GitHub remote, got ${remoteUrl}`);
  }
  const timeoutMs = 30 * 60 * 1000;
  const pollMs = 5 * 1000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let output = "";
    try {
      const result = await execFileAsync(
        "gh",
        [
          "run",
          "list",
          "--workflow",
          "quality-checks.yml",
          "--branch",
          branch,
          "--commit",
          commit,
          "--limit",
          "1",
          "--json",
          "databaseId,status,conclusion",
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      output = String(result.stdout || "");
    } catch (error) {
      throw new Error(
        `Unable to query GitHub Quality Checks. Install and authenticate gh: ${error.message}`,
      );
    }
    const runs = JSON.parse(output || "[]");
    const run = runs[0];
    if (run?.status === "completed") {
      if (run.conclusion === "success") {
        console.log(`[release] remote Quality Checks passed for ${commit}`);
        return;
      }
      throw new Error(
        `Remote Quality Checks failed for ${commit} (run ${run.databaseId}, ${run.conclusion})`,
      );
    }
    if (run?.databaseId)
      console.log(`[release] waiting for remote Quality Checks run ${run.databaseId}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for remote Quality Checks for ${commit}`);
}

async function resolveReleaseNotes(tagName = "") {
  const notesPath = path.join(".github", "release-notes", `${tagName}.md`);
  try {
    await fs.access(notesPath);
    return notesPath;
  } catch {
    return "";
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tagName = `v${args.version}`;
  const branch = await resolveBranch(args.branch);
  const releaseNotes = await resolveReleaseNotes(tagName);

  await assertCleanWorkingTree();
  await assertTagDoesNotExist(tagName, args.remote);

  console.log(`[release] preparing ${tagName} on ${branch}`);
  if (args.dryRun) {
    console.log(`[release][dry-run] npm run release:version -- ${args.version}`);
  } else {
    await bumpVersion(args.version);
  }

  console.log("[release] running quality checks for the final release version");
  await runOrPrint("npm", ["run", "check:quality"], args);
  console.log("[release] running full repository regression for the final release version");
  await runOrPrint("npm", ["test"], args);
  if (!args.dryRun) await assertCleanWorkingTree();

  await runOrPrint("git", ["add", "."], args);
  await runOrPrint("git", ["commit", "-m", `chore: release ${tagName}`], args);
  if (!args.skipPush) {
    const commit = await gitOutput(["rev-parse", "HEAD"]);
    await runOrPrint("git", ["push", args.remote, branch], args);
    await waitForRemoteQuality(branch, commit, args);
  }
  const tagArgs = releaseNotes
    ? ["tag", "--annotate", tagName, "--file", releaseNotes]
    : ["tag", tagName];
  await runOrPrint("git", tagArgs, args);
  if (!args.skipPush) {
    await runOrPrint("git", ["push", args.remote, tagName], args);
  }
  console.log(`[release] ${tagName} is ready`);
}

main().catch((error) => {
  console.error("[release] failed:", error?.message || error);
  process.exitCode = 1;
});
