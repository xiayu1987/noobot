/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODEL_LIBRARY_VERSION,
  listModelLibraryOptions,
  resolveModelLibraryProvider,
} from "@noobot/model-protocol";
import {
  CONFIG_DOCUMENT_SCOPE,
  upgradeConfigModelLibrary,
  repairConfigDocument,
} from "../src/index.js";

const alias = listModelLibraryOptions()[0].key;
const base = JSON.parse(
  readFileSync(new URL("../../service/config/global.config.example.json", import.meta.url)),
);

for (const scope of Object.values(CONFIG_DOCUMENT_SCOPE)) {
  test(`${scope}: unversioned models become custom, names deduplicate without overwriting`, () => {
    const existing = {
      ...resolveModelLibraryProvider(alias),
      model: "my-model",
      api_key: "my-key",
      enabled: false,
    };
    const target = { providers: { [alias]: existing, private_model: { model: "private" } } };
    const upgraded = upgradeConfigModelLibrary(target);
    assert.equal(target.providers[alias].is_custom, false);
    assert.deepEqual(upgraded.document.providers[alias], { ...existing, is_custom: true });
    assert.equal(upgraded.document.providers.private_model.is_custom, true);
    assert.equal(upgraded.document.model_library_version, MODEL_LIBRARY_VERSION);
    for (const { key } of listModelLibraryOptions()) {
      assert.ok(upgraded.document.providers[key]);
      if (key !== alias) assert.equal(upgraded.document.providers[key].is_custom, false);
    }
    const repaired = repairConfigDocument({
      scope,
      baseValues: base,
      target: upgraded.document,
    }).document;
    assert.equal(repaired.providers[alias].is_custom, true);
    assert.equal(repaired.model_library_version, MODEL_LIBRARY_VERSION);
    assert.deepEqual(upgradeConfigModelLibrary(repaired).document, repaired);
  });

  test(`${scope}: version change removes retired builtins, retains custom models and never resurrects them during repair`, () => {
    const target = {
      model_library_version: MODEL_LIBRARY_VERSION - 1,
      providers: {
        [alias]: { ...resolveModelLibraryProvider(alias), is_custom: true, api_key: "preserved" },
        removed: { model: "retired", is_custom: false },
        unmarked: { model: "retired-unmarked" },
        custom: { model: "custom", is_custom: true },
      },
    };
    const upgraded = upgradeConfigModelLibrary(target);
    assert.deepEqual(upgraded.report.removed, ["removed", "unmarked"]);
    assert.equal(upgraded.document.providers.custom.is_custom, true);
    assert.equal(upgraded.document.providers[alias].api_key, "preserved");
    assert.equal(upgraded.document.providers[alias].is_custom, true);
    const repaired = repairConfigDocument({
      scope,
      baseValues: { ...base, providers: { ...base.providers, ...target.providers } },
      target: upgraded.document,
    });
    assert.equal(repaired.document.providers.removed, undefined);
    assert.equal(repaired.document.providers.unmarked, undefined);
    assert.equal(repaired.document.model_library_version, MODEL_LIBRARY_VERSION);
  });
}

test("matching versions do not sync membership or modify flags", () => {
  const target = {
    model_library_version: MODEL_LIBRARY_VERSION,
    providers: { custom: { model: "x", is_custom: true } },
  };
  const upgraded = upgradeConfigModelLibrary(target);
  assert.equal(upgraded.report.changed, false);
  assert.deepEqual(upgraded.document, target);
});

test("version one configurations receive generation templates without overwriting credentials", () => {
  const existing = {
    ...resolveModelLibraryProvider("gpt_image_2_5_flare"),
    api_key: "existing-image-key",
    base_url: "https://images.example.test/v1",
  };
  const target = {
    model_library_version: 1,
    default_provider: "gpt_image_2_5_flare",
    providers: { gpt_image_2_5_flare: existing },
  };
  const upgraded = upgradeConfigModelLibrary(target);
  assert.equal(upgraded.report.changed, true);
  assert.equal(upgraded.document.model_library_version, MODEL_LIBRARY_VERSION);
  assert.equal(upgraded.document.default_provider, target.default_provider);
  assert.deepEqual(upgraded.document.providers.gpt_image_2_5_flare, existing);
  assert.ok(upgraded.report.added.includes("gpt_image_2_6_sunburst"));
  assert.ok(upgraded.report.added.includes("gemini_omni_1_2_flash"));
  assert.equal(upgraded.document.providers.gemini_omni_1_2_flash.enabled, true);
  assert.equal(upgradeConfigModelLibrary(upgraded.document).report.changed, false);
  assert.deepEqual(target.providers, { gpt_image_2_5_flare: existing });
});

test("supplier migration uses exact builtin declarations and preserves custom models and credentials", () => {
  const provider = { ...resolveModelLibraryProvider(alias), api_key: "private", enabled: false };
  delete provider.supplier;
  const target = {
    model_library_version: 2,
    providers: {
      [alias]: provider,
      custom: { model: provider.model, is_custom: true, supplier: "Private lab" },
      claude_opus_5: { model: "renamed-model", is_custom: false },
    },
  };
  const upgraded = upgradeConfigModelLibrary(target);
  assert.deepEqual(upgraded.document.providers[alias], {
    ...provider,
    supplier: resolveModelLibraryProvider(alias).supplier,
  });
  assert.deepEqual(upgraded.document.providers.custom, target.providers.custom);
  assert.deepEqual(upgraded.document.providers.claude_opus_5, target.providers.claude_opus_5);
  assert.equal(target.providers[alias].supplier, undefined);
  const repaired = repairConfigDocument({ baseValues: base, target: upgraded.document }).document;
  assert.equal(repaired.providers[alias].supplier, resolveModelLibraryProvider(alias).supplier);
  assert.equal(repaired.providers.custom.supplier, "Private lab");
  assert.equal(upgradeConfigModelLibrary(upgraded.document).report.changed, false);
});

test("library upgrade replaces stale capabilities from declarations without mutating input", () => {
  const declaration = resolveModelLibraryProvider(alias);
  const provider = {
    ...declaration,
    api_key: "private-key",
    base_url: "https://private.example.test/v1",
    enabled: false,
    capabilities: { tools: false },
    multimodal_parsing: { enabled: false, input_modalities: [] },
    multimodal_generation: {
      support_generation: { enabled: true, support_scope: ["video"] },
    },
  };
  const target = {
    model_library_version: MODEL_LIBRARY_VERSION - 1,
    providers: { [alias]: provider, custom: { ...provider, is_custom: true } },
  };
  const before = structuredClone(target);
  const upgraded = upgradeConfigModelLibrary(target);
  assert.deepEqual(upgraded.document.providers[alias], {
    ...declaration,
    api_key: provider.api_key,
    base_url: provider.base_url,
    enabled: false,
  });
  assert.deepEqual(upgraded.document.providers.custom, target.providers.custom);
  assert.deepEqual(target, before);
  assert.deepEqual(upgradeConfigModelLibrary(upgraded.document).document, upgraded.document);
});

test("repair does not assign a missing catalog version from base values", () => {
  const repaired = repairConfigDocument({
    baseValues: base,
    target: { providers: base.providers },
  });
  assert.equal(repaired.document.model_library_version, undefined);
});

test("invalid upgrade inputs fail explicitly without mutating input", () => {
  for (const target of [
    null,
    [],
    { model_library_version: "1" },
    { model_library_version: MODEL_LIBRARY_VERSION + 1, providers: {} },
    { providers: [] },
    { providers: { invalid: null } },
    {
      model_library_version: MODEL_LIBRARY_VERSION + 1,
      providers: { invalid: { is_custom: "false" } },
    },
  ]) {
    const before = structuredClone(target);
    assert.throws(
      () => upgradeConfigModelLibrary(target),
      (error) => {
        if (target === null || Array.isArray(target)) return error instanceof TypeError;
        assert.equal(error.code, "INVALID_MODEL_LIBRARY_CONFIG");
        assert.equal(error.details.impact, "document");
        assert.equal(error.details.autoRepair, false);
        return true;
      },
    );
    assert.deepEqual(target, before);
  }
});

test("native generation declaration upgrade preserves configured credentials and endpoint", () => {
  const provider = resolveModelLibraryProvider("gpt_image_2_5_flare");
  provider.api_key = "${PRIVATE_IMAGE_KEY}";
  provider.base_url = "${PRIVATE_IMAGE_ADDRESS}";
  provider.multimodal_generation.support_generation.api_type = "images_async";
  const upgraded = upgradeConfigModelLibrary({
    model_library_version: 1,
    providers: { gpt_image_2_5_flare: provider },
  });
  const result = upgraded.document.providers.gpt_image_2_5_flare;
  assert.equal(result.api_key, "${PRIVATE_IMAGE_KEY}");
  assert.equal(result.base_url, "${PRIVATE_IMAGE_ADDRESS}");
  assert.equal(result.multimodal_generation.support_generation.api_type, "openai_images");
});
