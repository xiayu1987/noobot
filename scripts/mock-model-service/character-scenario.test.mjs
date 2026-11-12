/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnimationTools } from "../../plugin/noobot-plugin-character/src/animation-tools.js";
import { assets } from "../../plugin/noobot-plugin-character/__tests__/fixtures/animation-fixtures.js";
import { characterSteps } from "./character-scenario.mjs";

test("character replay reads and updates the same artifact through revisions 1, 2 and 3", async () => {
  const artifacts = new Map();
  const tools = createAnimationTools({
    resolveSelectedAssets: async () => [
      {
        ...assets[0],
        assetId: "sample.three.robot-expressive",
        animations: [{ name: "Wave", duration: 2, tracks: 42 }],
        nodes: [],
      },
    ],
    getArtifact: async ({ artifactId }) =>
      artifacts.get(artifactId) || { found: false, artifact: null, revision: 0 },
    commitArtifact: async ({ artifactId, baseRevision, data }) => {
      const previous = artifacts.get(artifactId);
      if (previous) assert.equal(baseRevision, previous.revision);
      const revision = (previous?.revision || 0) + 1;
      artifacts.set(artifactId, { found: true, revision, artifact: data });
      return { committed: true, revision, eventId: `event-${revision}` };
    },
  });
  for (const step of characterSteps("unit-character")) {
    const result = JSON.parse(
      await tools.find((tool) => tool.name === step.name).invoke(step.args),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const first = characterSteps("unit-character")[0].args.protocol.animationId;
  assert.equal(artifacts.get(first).revision, 3);
  const missing = JSON.parse(
    await tools
      .find((tool) => tool.name === "character_animation_get")
      .invoke({ animationId: "animation.missing" }),
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "ANIMATION_NOT_FOUND");
  assert.equal(typeof missing.error, "string");
});
