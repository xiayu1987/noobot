/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { composeSystemInfoSections } from "../../../src/system-core/context/formatters/system-prompt-formatter.js";

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

test("composeSystemInfoSections adds concise path guidance for only the active path view", () => {
  const regularSandboxSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      sandbox: {
        enabled: true,
        allowedRoots: ["/runtime-root"],
        defaultWorkdir: "/runtime-root/work",
      },
      identity: { isSuperUser: false },
    },
  });
  const regularSandboxText = regularSandboxSections.join("\n\n");
  assert.equal(regularSandboxText.includes("# Path rules"), true);
  assert.equal(regularSandboxText.includes("Sandbox view"), true);
  assert.equal(regularSandboxText.includes("host absolute paths"), false);
  assert.equal(regularSandboxText.includes("Super user"), false);
  assert.equal(regularSandboxText.includes("Extra mounts"), false);
  assert.equal(regularSandboxText.includes("Sandbox is disabled"), false);
  assert.equal(regularSandboxText.includes("/project"), false);

  const mountedSandboxSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      sandbox: {
        enabled: true,
        allowedRoots: ["/workspace", "/data"],
        extraMountTargets: ["/data"],
      },
      identity: { isSuperUser: true },
    },
  });
  const mountedSandboxText = mountedSandboxSections.join("\n\n");
  assert.equal(mountedSandboxText.includes("Sandbox view"), true);
  assert.equal(mountedSandboxText.includes("Extra mounts"), true);
  assert.equal(mountedSandboxText.includes("Super user"), false);
  assert.equal(mountedSandboxText.includes("Host view"), false);

  const superHostSections = composeSystemInfoSections({
    locale: "en-US",
    systemPrompt: "base",
    staticInfo: {
      identity: { isSuperUser: true },
    },
  });
  const superHostText = superHostSections.join("\n\n");
  assert.equal(superHostText.includes("Host view"), true);
  assert.equal(superHostText.includes("Super user"), true);
  assert.equal(superHostText.includes("sandbox"), false);
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
