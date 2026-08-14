/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { composeSystemInfoSections } from "../../src/context/formatters/system-prompt-formatter.js";

test("composeSystemInfoSections omits conditional sections when data is empty", () => {
  const sections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {},
    dynamicInfo: {},
    scenarioSection: {},
    workspaceDirectories: [],
    modelSection: {},
    skills: [],
    services: [],
    mcpServers: [],
    attachments: [],
    connectorStatusSection: {},
  });

  const joined = sections.join("\n\n");
  assert.equal(joined.includes("Available MCP servers"), false);
  assert.equal(joined.includes("Current connector information"), false);
  assert.equal(joined.includes("Current attachment metadata"), false);
});

test("composeSystemInfoSections includes MCP/connectors/attachments when data exists", () => {
  const sections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: { a: 1 },
    dynamicInfo: { b: 2 },
    scenarioSection: { key: "coding" },
    workspaceDirectories: ["runtime"],
    modelSection: { current: { name: "gpt" } },
    skills: [{ name: "skill-a" }],
    services: [{ serviceName: "svc", endpointName: "query" }],
    mcpServers: [{ name: "mcp-a", type: "stdio" }],
    attachments: [{ attachmentId: "att_1", path: "/tmp/a.png" }],
    connectorStatusSection: {
      connectors: { databases: [], terminals: [], emails: [] },
      current_connectors: {
        database: {
          connector_name: "prod-db",
          connector_type: "database",
        },
      },
    },
  });

  const joined = sections.join("\n\n");
  assert.equal(joined.includes("Available MCP servers"), true);
  assert.equal(joined.includes("Current connector information"), true);
  assert.equal(joined.includes("Current attachment metadata"), true);
});

test("composeSystemInfoSections projects only model-owned execution context", () => {
  const sections = composeSystemInfoSections({
    locale: "en-US",
    dynamicInfo: {
      now: "2026-08-05T12:00:00.000Z",
      caller: "user",
      sessionId: "session-secret",
      dialogProcessId: "dialog-secret",
      currentDialogProcessId: "dialog-current-secret",
      parentDialogProcessId: "dialog-parent-secret",
      turnScopeId: "turn-secret",
      config: {
        allowUserInteraction: false,
        turnScopeId: "turn-config-secret",
        safeConfirm: true,
        safeConfirmLevel: "critical",
        sanitizeOutput: true,
        streaming: true,
        toolPolicy: { denyToolNames: ["secret-tool"] },
      },
      sessionTree: {
        roots: ["unrelated-session-secret"],
        nodes: { "unrelated-session-secret": { sessionId: "unrelated-session-secret" } },
      },
      nested: [{ dialogProcessId: "dialog-nested-secret", value: "kept" }],
    },
  });

  const joined = sections.join("\n\n");
  assert.equal(joined.includes("2026-08-05T12:00:00.000Z"), true);
  assert.equal(joined.includes('"caller": "user"'), true);
  assert.equal(joined.includes('"allowUserInteraction": false'), true);
  for (const forbidden of [
    "session-secret",
    "dialogProcessId",
    "currentDialogProcessId",
    "parentDialogProcessId",
    "turnScopeId",
    "sessionTree",
    "unrelated-session-secret",
    "dialog-secret",
    "turn-secret",
    "safeConfirm",
    "safeConfirmLevel",
    "sanitizeOutput",
    "streaming",
    "toolPolicy",
    "secret-tool",
    "nested",
    "value",
  ]) {
    assert.equal(joined.includes(forbidden), false, forbidden);
  }
});

test("composeSystemInfoSections describes the active workspace execution view", () => {
  const regularSandboxSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      directories: { view: "sandbox", allowedRoots: ["/workspace"] },
      identity: { isSuperUser: false },
    },
  });
  const regularSandboxText = regularSandboxSections.join("\n\n");
  assert.equal(regularSandboxText.includes("# Path rules"), true);
  assert.equal(regularSandboxText.includes("workspace logical view"), true);
  assert.equal(regularSandboxText.includes("Sandbox mode is active"), true);
  assert.equal(regularSandboxText.includes("does not expose host paths"), true);
  assert.equal(regularSandboxText.includes("Super user"), false);
  assert.equal(regularSandboxText.includes("Extra mounts"), false);
  assert.equal(regularSandboxText.includes("Sandbox is disabled"), false);
  assert.equal(regularSandboxText.includes("/project"), false);

  const mountedSandboxSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      directories: {
        view: "sandbox",
        allowedRoots: ["/workspace", "/data"],
        extraMountTargets: ["/data"],
      },
      identity: { isSuperUser: true },
    },
  });
  const mountedSandboxText = mountedSandboxSections.join("\n\n");
  assert.equal(mountedSandboxText.includes("workspace logical view"), true);
  assert.equal(mountedSandboxText.includes("Extra mounts"), false);
  assert.equal(mountedSandboxText.includes("does not expose host paths"), true);
  assert.equal(mountedSandboxText.includes("host absolute paths are allowed"), false);

  const superHostSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      directories: { view: "host" },
      identity: { isSuperUser: true },
    },
  });
  const superHostText = superHostSections.join("\n\n");
  assert.equal(superHostText.includes("workspace logical view"), true);
  assert.equal(superHostText.includes("Super user"), true);
  assert.equal(superHostText.includes("Host mode is active"), true);
  assert.equal(superHostText.includes("task-local paths last for one call"), true);
  assert.equal(superHostText.includes("output names are not paths"), true);
  assert.equal(superHostText.includes("never construct workspace or host paths"), true);
});

test("composeSystemInfoSections uses attachments as attachment context", () => {
  const sections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    attachments: [{ attachmentId: "input_att", path: "/tmp/input.png" }],
  });

  const joined = sections.join("\n\n");
  assert.equal(joined.includes("input_att"), true);
});

test("attachment context documents the workspace layout and keeps identity authoritative", () => {
  const sections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    workspaceDirectories: ["runtime", "runtime/attach", "runtime/ops_workdir"],
    attachments: [{ attachmentId: "input_att", sessionId: "s1", attachmentSource: "user" }],
  });

  const joined = sections.join("\n\n");
  assert.equal(joined.includes("input_att"), true);
  assert.equal(joined.includes("runtime/attach/scoped/<sessionId>/<attachmentSource>/"), true);
  assert.equal(joined.includes("workspace-relative path for search or audit"), true);
  assert.equal(joined.includes("complete attachment identity for cross-tool transfer"), true);
  assert.equal(joined.includes("/workspace/"), false);
});
