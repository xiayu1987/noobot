/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { composeSystemInfoSections } from "../../../src/context/formatters/system-prompt-formatter.js";

test("composeSystemInfoSections omits connector prompt blocks when no connector is selected", () => {
  const sections = composeSystemInfoSections({
    locale: "zh-CN",
    systemPrompt: "base",
    staticInfo: { cwd: "/tmp" },
    dynamicInfo: {
      config: {
        allowUserInteraction: true,
        selectedConnectorIds: [],
      },
    },
    connectorStatusSection: {
      connectors: [],
    },
  });

  const prompt = sections.join("\n\n");
  assert.equal(prompt.includes("connector_name"), false);
});
