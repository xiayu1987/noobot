/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { composeSystemInfoSections } from "../../../../src/system-core/context/formatters/system-prompt-formatter.js";

test("composeSystemInfoSections omits connector prompt blocks when no connector is selected", () => {
  const sections = composeSystemInfoSections({
    locale: "zh-CN",
    systemPrompt: "base",
    staticInfo: { cwd: "/tmp" },
    dynamicInfo: {
      config: {
        allowUserInteraction: true,
        selectedConnectors: {
          database: "",
          terminal: "",
          email: "",
        },
      },
    },
    connectorStatusSection: {
      connectors: {
        databases: [{ connector_name: "db1" }],
        terminals: [],
        emails: [],
      },
      current_connectors: {
        database: null,
        terminal: null,
        email: null,
      },
    },
  });

  const prompt = sections.join("\n\n");
  assert.equal(prompt.includes("selectedConnectors"), false);
  assert.equal(prompt.includes("current_connectors"), false);
});
