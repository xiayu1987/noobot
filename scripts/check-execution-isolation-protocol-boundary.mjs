#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const violations = [];

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function assertAbsent(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    violations.push(
      `${relativePath}: obsolete duplicate execution-isolation protocol is forbidden`,
    );
  } catch {
    // Absence is required.
  }
}

await assertAbsent("agent-config-protocol/src/execution-isolation.js");
await assertAbsent("agent/src/tools/execution/script-tool/sandbox-config.js");

const protocolSource = await source("execution-isolation-protocol/src/protocol.js");
for (const marker of [
  "EXECUTION_ISOLATION_PROTOCOL_NAME",
  "TOOL_EXECUTION_CLASS",
  "TOOL_EXECUTION_VIEW",
  "normalizeSandboxMounts",
  "resolveWorkspaceSandboxLayout",
  "assertToolExecutionPolicy",
  "resolveToolExecutionPolicy",
]) {
  if (!protocolSource.includes(marker)) {
    violations.push(`execution-isolation-protocol/src/protocol.js: missing ${marker}`);
  }
}

const ownershipChecks = [
  ["agent/src/config/index.js", "@noobot/execution-isolation-protocol"],
  ["agent/src/sandbox/docker-sandbox.js", "@noobot/execution-isolation-protocol"],
  ["path-resolver/src/sandbox-mapping.mjs", "@noobot/execution-isolation-protocol"],
  ["agent/src/tools/core/check-tool-input.js", "resolveExecutionIsolation"],
  ["agent/src/tools/core/workspace-io-executor.js", "assertToolExecutionPolicy"],
  [
    "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/operation-directory.js",
    "resolveRuntimePathContext",
  ],
];
for (const [relativePath, marker] of ownershipChecks) {
  if (!(await source(relativePath)).includes(marker)) {
    violations.push(`${relativePath}: must consume ${marker}`);
  }
}

const legacyFields =
  /\b(?:dockerMounts|dockerContainerScope|dockerContainerName|dockerImage|dockerWorkdir|dockerLockWaitTimeoutMs|mountSource|mountTarget|mountDescription|dockerProjectMountSource|dockerProjectMountTarget|sandboxPathMappings)\b/;
for (const relativePath of [
  "agent/src/sandbox/docker-sandbox.js",
  "path-resolver/src/sandbox-mapping.mjs",
]) {
  if (legacyFields.test(await source(relativePath))) {
    violations.push(`${relativePath}: legacy execution-isolation field is forbidden`);
  }
}

const duplicateLayoutRules = [
  ["agent/src/sandbox/docker-sandbox.js", /["'`]\/workspace(?:\/|["'`])/],
  ["path-resolver/src/runtime-context.mjs", /["'`]\/workspace(?:\/|["'`])/],
  ["path-resolver/src/tool-path.mjs", /["'`]\/workspace(?:\/|["'`])/],
  ["agent/src/tools/execution/script-tool/constants.js", /runtime\/ops_workdir/],
];
for (const [relativePath, pattern] of duplicateLayoutRules) {
  if (pattern.test(await source(relativePath))) {
    violations.push(`${relativePath}: workspace sandbox layout must come from the protocol`);
  }
}

if (/\bscriptConfig\b/.test(await source("agent/src/sandbox/docker-sandbox.js"))) {
  violations.push(
    "agent/src/sandbox/docker-sandbox.js: resolved isolation protocol must replace scriptConfig",
  );
}

for (const relativePath of [
  "agent/src/tools/core/check-tool-input.js",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/operation-directory.js",
]) {
  if (/globalConfig[^\n]{0,80}executionIsolation/.test(await source(relativePath))) {
    violations.push(
      `${relativePath}: raw executionIsolation access must use the protocol resolver`,
    );
  }
}

if (violations.length) {
  console.error(`[execution-isolation-protocol-boundary] failed\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("[execution-isolation-protocol-boundary] ok");
}
