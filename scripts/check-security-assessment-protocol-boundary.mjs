#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const violations = [];

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function assertAbsent(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    violations.push(`${relativePath}: obsolete duplicate risk protocol is forbidden`);
  } catch {
    // Absence is required.
  }
}

await assertAbsent("event-protocol/src/tool-risk.js");

const protocolSource = await source("security-assessment-protocol/src/index.js");
for (const marker of [
  "SECURITY_ASSESSMENT_PROTOCOL_NAME",
  "SECURITY_RISK_LEVEL",
  "TOOL_BASELINE_PROFILES",
  "classifyToolExecutionRisk",
  "classifyResourceRisk",
  "createSecurityAssessment",
  "raiseSecurityAssessment",
  "shouldRequireSecurityConfirmation",
]) {
  if (!protocolSource.includes(marker)) {
    violations.push(`security-assessment-protocol/src/index.js: missing ${marker}`);
  }
}

for (const [relativePath, marker] of [
  ["agent/src/tools/execution/tool-risk.js", "createSecurityAssessment"],
  ["agent/src/tools/execution/file-read-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-write-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-search-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/file-patch-tool.js", "classifyResourceRisk"],
  ["agent/src/tools/execution/script-tool.js", "classifyToolExecutionRisk"],
  ["event-protocol/src/message-event.js", "validateSecurityAssessment"],
  ["client/noobot-chat/src/shared/ui/BaseThinkingLogLine.vue", "normalizeSecurityRiskLevel"],
]) {
  if (!(await source(relativePath)).includes(marker)) {
    violations.push(`${relativePath}: must consume ${marker}`);
  }
}

async function sourceFiles(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (
      entry.isDirectory() &&
      !new Set([
        ".git",
        "__tests__",
        "build",
        "dist",
        "i18n",
        "node_modules",
        "scripts",
        "security-assessment-protocol",
        "test",
        "tests",
        "vendor",
      ]).has(entry.name)
    )
      files.push(...(await sourceFiles(relativePath)));
    else if (/\.(?:js|mjs|vue)$/.test(entry.name)) files.push(relativePath);
  }
  return files;
}

const productionRoots = [
  "agent-config-protocol/src",
  "agent-proxy/src",
  "agent-transport-protocol/src",
  "agent/src",
  "attachment-protocol/src",
  "authoritative-state/src",
  "client/mac/src",
  "client/noobot-chat/src",
  "client/shared/electron",
  "client/startup/src",
  "client/windows/src",
  "context-protocol/src",
  "event-protocol/src",
  "execution-isolation-protocol/src",
  "hook-protocol/src",
  "model-protocol/src",
  "model-proxy/src",
  "model-runtime/src",
  "path-resolver/src",
  "plugin-protocol/src",
  "plugin-runtime/src",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "runtime-events/src",
  "sanitize/src",
  "semantic-transfer-protocol/src",
  "service/bootstrap",
  "service/config",
  "service/deps",
  "service/routes",
  "service/runtime-events",
  "service/services",
  "service/ws",
  "session-protocol/src",
  "session-repair/src",
  "workflow/src",
];
const forbiddenDefinitions = [
  /\b(?:const|let|var)\s+(?:RISK_ORDER|TOOL_BASELINE_PROFILES|CONFIRMATION_MINIMUM_RISK|CONFIRMATION_LEVELS)\b/,
  /(?:new\s+Set\s*\()?\[\s*["']low["']\s*,\s*["']medium["']\s*,\s*["']high["']\s*,\s*["']critical["']\s*\]/,
  /\bmaxSecurityRiskLevel\s*\(/,
];
for (const relativePath of (await Promise.all(productionRoots.map(sourceFiles))).flat()) {
  const content = await source(relativePath);
  if (forbiddenDefinitions.some((pattern) => pattern.test(content))) {
    violations.push(`${relativePath}: security classification belongs to the protocol package`);
  }
}

if (violations.length) {
  console.error(`[security-assessment-protocol-boundary] failed\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("[security-assessment-protocol-boundary] ok");
}
