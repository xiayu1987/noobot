#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const PROJECT_JSON_FILES = [
  "package.json",
  "service/package.json",
  "agent/package.json",
  "agent-proxy/package.json",
  "model-proxy/package.json",
  "i18n/package.json",
  "shared/package.json",
  "workflow/package.json",
  "plugin/noobot-plugin-harness/package.json",
  "plugin/noobot-plugin-workflow/package.json",
  "client/noobot-chat/package.json",
  "client/startup/package.json",
  "client/windows/package.json",
  "client/mac/package.json",
  "plugin/noobot-plugin-harness/manifest.json",
  "plugin/noobot-plugin-workflow/manifest.json",
];

const PLUGIN_CONSTANT_FILES = [
  "plugin/noobot-plugin-harness/src/core/constants.js",
  "plugin/noobot-plugin-workflow/src/core/constants.js",
];

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeVersion(input = "") {
  return String(input || "").trim().replace(/^v/, "");
}

export function assertVersion(version = "") {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid version "${version}". Expected semver like 3.0.0.`);
  }
}

async function readJson(relativeFile) {
  const filePath = path.resolve(repoRoot, relativeFile);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(relativeFile, data) {
  const filePath = path.resolve(repoRoot, relativeFile);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function updateJsonVersion(relativeFile, version) {
  const data = await readJson(relativeFile);
  data.version = version;
  await writeJson(relativeFile, data);
}

async function updatePackageLock(version) {
  const lockFile = "package-lock.json";
  const lock = await readJson(lockFile);
  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }
  for (const relativeFile of PROJECT_JSON_FILES) {
    if (relativeFile === "package.json" || relativeFile.endsWith("/manifest.json")) continue;
    const packageDir = relativeFile.slice(0, -"package.json".length).replace(/\/$/, "");
    const packageKey = packageDir || "";
    if (lock.packages?.[packageKey]) {
      lock.packages[packageKey].version = version;
    }
  }
  await writeJson(lockFile, lock);
}

async function updatePluginConstant(relativeFile, version) {
  const filePath = path.resolve(repoRoot, relativeFile);
  const source = await fs.readFile(filePath, "utf8");
  const versionPattern = /export const PLUGIN_VERSION = "([^"]*)";/;
  if (!versionPattern.test(source)) {
    throw new Error(`Could not find PLUGIN_VERSION in ${relativeFile}`);
  }
  const nextSource = source.replace(
    versionPattern,
    `export const PLUGIN_VERSION = "${version}";`,
  );
  await fs.writeFile(filePath, nextSource, "utf8");
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

export async function bumpVersion(inputVersion = "") {
  const version = normalizeVersion(inputVersion);
  assertVersion(version);

  for (const relativeFile of PROJECT_JSON_FILES) {
    await updateJsonVersion(relativeFile, version);
  }
  await updatePackageLock(version);
  for (const relativeFile of PLUGIN_CONSTANT_FILES) {
    await updatePluginConstant(relativeFile, version);
  }
  await run("npm", ["run", "-w", "client/noobot-chat", "generate:frontend-plugin-entries"]);

  console.log(`[bump-version] updated project version to ${version}`);
  return version;
}

async function main() {
  await bumpVersion(process.argv[2]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[bump-version] failed:", error?.message || error);
    process.exitCode = 1;
  });
}
