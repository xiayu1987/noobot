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
    attachmentMetas: [],
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
    attachmentMetas: [{ attachmentId: "att_1", path: "/tmp/a.png" }],
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
