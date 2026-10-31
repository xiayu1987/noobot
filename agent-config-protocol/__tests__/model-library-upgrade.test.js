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
      model_library_version: MODEL_LIBRARY_VERSION + 1,
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
    { providers: [] },
    { providers: { invalid: null } },
    { model_library_version: 2, providers: { invalid: { is_custom: "false" } } },
  ]) {
    const before = structuredClone(target);
    assert.throws(() => upgradeConfigModelLibrary(target), TypeError);
    assert.deepEqual(target, before);
  }
});
