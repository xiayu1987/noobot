#!/usr/bin/env node
import { execFile } from "node:child_process";
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
      [
        "Working tree is not clean. Commit or stash existing changes before release.",
        status,
      ].join("\n"),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tagName = `v${args.version}`;
  const branch = await resolveBranch(args.branch);

  await assertCleanWorkingTree();
  await assertTagDoesNotExist(tagName, args.remote);

  console.log(`[release] preparing ${tagName} on ${branch}`);
  if (args.dryRun) {
    console.log(`[release][dry-run] npm run release:version -- ${args.version}`);
  } else {
    await bumpVersion(args.version);
  }

  await runOrPrint("git", ["add", "."], args);
  await runOrPrint("git", ["commit", "-m", `chore: release ${tagName}`], args);
  await runOrPrint("git", ["tag", tagName], args);
  if (!args.skipPush) {
    await runOrPrint("git", ["push", args.remote, branch], args);
    await runOrPrint("git", ["push", args.remote, tagName], args);
  }
  console.log(`[release] ${tagName} is ready`);
}

main().catch((error) => {
  console.error("[release] failed:", error?.message || error);
  process.exitCode = 1;
});
