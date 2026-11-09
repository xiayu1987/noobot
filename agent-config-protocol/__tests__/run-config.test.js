/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import { RunConfigResolver } from "../src/index.js";

test("scenario lookup ignores inherited names and still resolves deny conflicts", () => {
  const resolver = new RunConfigResolver();
  for (const scenario of ["__proto__", "constructor", "toString", "unknown"]) {
    const resolved = resolver.resolveScenarioRunConfig({
      scenario,
      toolPolicy: { allowToolNames: ["read_file"], denyToolNames: ["read_file"] },
    });
    assert.equal(resolved.scenario, scenario);
    assert.equal(Object.hasOwn(resolved, "scenarioProfile"), false);
    assert.deepEqual(resolved.toolPolicy.allowToolNames, []);
  }
});

test("scenario profiles own their arrays independently of other resolutions", () => {
  const resolver = new RunConfigResolver();
  for (const scenario of ["full", "programming", "text"]) {
    const first = resolver.resolveScenarioRunConfig({ scenario });
    const expected = structuredClone(first.scenarioProfile);
    for (const field of ["tools", "context", "services", "mcpServers"]) {
      first.scenarioProfile[field].push("mutated");
    }
    assert.deepEqual(resolver.resolveScenarioRunConfig({ scenario }).scenarioProfile, expected);
  }
});

test("run config resolver uses the canonical default scenario and intersects explicit policy", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        default: "programming",
      },
    },
  });
  const resolved = resolver.resolveScenarioRunConfig(
    {
      toolPolicy: { allowToolNames: ["write_file", "other"] },
      contextPolicy: { promptSections: ["base_prompt", "services"] },
    },
    {},
  );

  assert.equal(resolved.scenario, "programming");
  assert.ok(resolved.scenarioProfile.tools.includes("read_file"));
  assert.deepEqual(resolved.toolPolicy.allowToolNames, ["write_file"]);
  assert.equal(resolved.toolPolicy.forceIncludeUserInteraction, false);
  assert.deepEqual(resolved.contextPolicy.promptSections, ["base_prompt", "services"]);
});
