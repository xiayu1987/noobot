/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DOCUMENT_SCOPE } from "../src/index.js";
import { repairConfigDocument } from "../src/pipeline/repair.js";

test("config repair fills only invalid fields for an unknown provider", () => {
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template: { providers: {} },
    target: {
      providers: {
        GLM_5_1: {
          enabled: true,
          used_for_conversation: true,
          api_key: "${DASHSCOPE_API_KEY}",
          base_url: "${DASHSCOPE_API_ADDRESS}",
          model: "ZHIPU/GLM-5.1",
        },
      },
    },
  });

  const provider = repaired.document.providers.GLM_5_1;
  assert.equal(provider.model, "ZHIPU/GLM-5.1");
  assert.equal("format" in provider, false);
  assert.equal(provider.api_key, "${DASHSCOPE_API_KEY}");
  assert.equal(provider.base_url, "${DASHSCOPE_API_ADDRESS}");
  assert.deepEqual(provider.reasoning_effort_options, ["low", "medium", "high"]);
  assert.equal(provider.reasoning_effort, "medium");
  assert.equal(provider.tool_reasoning_effort, "medium");
});

test("config repair adds the character plugin to legacy configuration", () => {
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template: {
      plugins: {
        character: {
          enabled: true,
          mode: "on",
          characterAssets: [],
          selectedCharacterAssetIds: [],
        },
      },
    },
    target: { plugins: {} },
  });

  assert.deepEqual(repaired.document.plugins.character, {
    enabled: true,
    mode: "on",
    characterAssets: [],
    selectedCharacterAssetIds: [],
  });
  assert.equal(repaired.report.changed, true);

  const customized = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template: {
      plugins: {
        character: {
          enabled: true,
          mode: "on",
          characterAssets: [],
          selectedCharacterAssetIds: [],
        },
      },
    },
    target: {
      plugins: {
        character: {
          enabled: true,
          mode: false,
          characterAssets: [{ assetId: "owned.asset" }],
          selectedCharacterAssetIds: ["owned.asset"],
        },
      },
    },
  });
  assert.equal(customized.document.plugins.character.mode, "on");
  assert.deepEqual(customized.document.plugins.character.characterAssets, [
    { assetId: "owned.asset" },
  ]);

  const unsupportedPlugin = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template: {
      plugins: {
        character: { enabled: true, mode: "on" },
      },
    },
    target: {
      plugins: {
        character: { enabled: true, mode: "on" },
        retired_plugin: { enabled: true, custom: "legacy" },
      },
    },
  });
  assert.equal(unsupportedPlugin.document.plugins.retired_plugin, undefined);
});
