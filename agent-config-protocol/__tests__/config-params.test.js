/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigParamCatalog,
  CONFIG_ERROR_CODE,
  CONFIG_DOCUMENT_SCOPE,
  configIssueBlocksStartup,
  createConfigValueLookup,
  mergeConfigParamLayers,
  normalizeConfigParamsDocument,
  parseConfigParamsDocumentText,
  resolveConfigTemplates,
  synchronizeConfigParamsDocument,
  UNRESOLVED_TEMPLATE_POLICY,
} from "../src/index.js";

test("config params document is the only values, descriptions, and catalog authority", () => {
  const document = normalizeConfigParamsDocument({
    values: { api_key: " key ", empty: "  " },
    descriptions: { api_key: " API credential ", region: " Region " },
  });
  assert.deepEqual(document, {
    values: { API_KEY: "key", EMPTY: "" },
    descriptions: { API_KEY: "API credential", REGION: "Region", EMPTY: "" },
  });
  assert.deepEqual(
    buildConfigParamCatalog({
      values: document.values,
      descriptions: document.descriptions,
      extraKeys: ["tenant"],
    }),
    [
      { key: "API_KEY", description: "API credential" },
      { key: "EMPTY", description: "" },
      { key: "REGION", description: "Region" },
      { key: "TENANT", description: "" },
    ],
  );
  assert.deepEqual(
    mergeConfigParamLayers({ API_KEY: "workspace", REGION: "cn" }, { api_key: "user" }),
    { API_KEY: "user", REGION: "cn" },
  );
});

test("config params document rejects ambiguous, invalid, and unknown facts", () => {
  for (const document of [
    { values: [] },
    { descriptions: [] },
    { values: { "API-KEY": "x" } },
    { values: { api_key: "x", API_KEY: "y" } },
    { values: {}, extra: true },
  ]) {
    assert.throws(
      () => normalizeConfigParamsDocument(document),
      (error) => error?.code === CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
    );
  }
});

test("config params invalid fields are classified without treating false values as missing", () => {
  for (const field of ["values", "descriptions"]) {
    for (const value of [null, false, 0, "", [], "invalid"]) {
      assert.throws(
        () => parseConfigParamsDocumentText(JSON.stringify({ [field]: value })),
        (error) => {
          assert.equal(error.code, CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT);
          assert.equal(error.details.autoRepair, false);
          assert.equal(configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.GLOBAL), true);
          assert.equal(configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.USER), false);
          return true;
        },
      );
    }
  }
  for (const source of ['{"API_KEY":"secret" trailing', "null", "[]"]) {
    assert.throws(
      () => parseConfigParamsDocumentText(source),
      (error) => {
        assert.equal(error.code, CONFIG_ERROR_CODE.INVALID_DOCUMENT);
        assert.equal(error.message.includes("secret"), false);
        return true;
      },
    );
  }
  assert.deepEqual(parseConfigParamsDocumentText("{}"), { values: {}, descriptions: {} });
});

test("config params entries require strings without converting or exposing invalid values", () => {
  for (const field of ["values", "descriptions"]) {
    for (const value of [{ nested: "private" }, ["private"], null, false, true, 0, 42]) {
      const document = { [field]: { API_KEY: value } };
      const source = JSON.stringify(document);
      for (const operation of [
        () => normalizeConfigParamsDocument(document),
        () => parseConfigParamsDocumentText(source),
        () => synchronizeConfigParamsDocument({ document, keys: ["REGION"] }),
      ]) {
        assert.throws(operation, (error) => {
          assert.equal(error.code, CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT);
          assert.equal(error.details.field, field);
          assert.equal(error.details.key, "API_KEY");
          assert.equal(error.details.autoRepair, false);
          assert.equal(JSON.stringify(error).includes("private"), false);
          assert.equal(error.message.includes("private"), false);
          return true;
        });
        assert.equal(JSON.stringify(document), source);
      }
    }
  }
});

test("config params document preserves valid keys outside the current template", () => {
  assert.deepEqual(
    normalizeConfigParamsDocument({
      values: { api_key: "secret" },
      descriptions: { api_key: "Credential" },
    }),
    {
      values: { API_KEY: "secret" },
      descriptions: { API_KEY: "Credential" },
    },
  );
  assert.deepEqual(normalizeConfigParamsDocument({ values: { UNUSED_KEY: "value" } }), {
    values: { UNUSED_KEY: "value" },
    descriptions: { UNUSED_KEY: "" },
  });
});

test("config params synchronization preserves stored keys and adds template keys", () => {
  assert.deepEqual(
    synchronizeConfigParamsDocument({
      document: {
        values: { ACTIVE_KEY: "preserved", RETIRED_KEY: "removed" },
        descriptions: { ACTIVE_KEY: "active", RETIRED_KEY: "retired" },
      },
      keys: ["NEW_KEY", "ACTIVE_KEY"],
    }),
    {
      values: { ACTIVE_KEY: "preserved", NEW_KEY: "", RETIRED_KEY: "removed" },
      descriptions: { ACTIVE_KEY: "active", NEW_KEY: "", RETIRED_KEY: "retired" },
    },
  );
});

test("template resolution has one explicit source order and unresolved policy", () => {
  const lookup = createConfigValueLookup(
    { API_KEY: "params", REGION: "cn" },
    { API_KEY: "environment" },
  );
  assert.deepEqual(resolveConfigTemplates({ key: "${API_KEY}", region: "${REGION}" }, { lookup }), {
    key: "params",
    region: "cn",
  });
  assert.equal(
    resolveConfigTemplates("${MISSING}", {
      lookup,
      unresolved: UNRESOLVED_TEMPLATE_POLICY.PRESERVE,
    }),
    "${MISSING}",
  );
  assert.throws(
    () =>
      resolveConfigTemplates("${MISSING}", {
        lookup,
        unresolved: UNRESOLVED_TEMPLATE_POLICY.ERROR,
      }),
    (error) => error?.code === CONFIG_ERROR_CODE.UNRESOLVED_TEMPLATE,
  );
  assert.throws(
    () => resolveConfigTemplates("${MISSING}", { lookup, unresolved: "fallback" }),
    /unsupported unresolved config template policy/,
  );
  assert.equal(
    resolveConfigTemplates("${MISSING}", { lookup, unresolved: UNRESOLVED_TEMPLATE_POLICY.EMPTY }),
    "",
  );
  assert.equal(resolveConfigTemplates("${MISSING}", { lookup }), "");
});

test("native generation providers use the existing template parameter collection and resolution", async () => {
  const { resolveModelLibraryProvider } = await import("@noobot/model-protocol");
  const { collectConfigTemplateKeys } = await import("../src/index.js");
  const provider = resolveModelLibraryProvider("gemini_omni_1_2_flash");
  assert.equal(provider.base_url, "${GEMINI_NATIVE_API_ADDRESS}");
  assert.deepEqual(collectConfigTemplateKeys(provider).sort(), [
    "GEMINI_API_KEY",
    "GEMINI_NATIVE_API_ADDRESS",
  ]);
  const resolved = resolveConfigTemplates(provider, {
    lookup: createConfigValueLookup({
      GEMINI_API_KEY: "private",
      GEMINI_NATIVE_API_ADDRESS: "https://configured.example.test/v1beta",
    }),
    unresolved: UNRESOLVED_TEMPLATE_POLICY.ERROR,
  });
  assert.equal(resolved.base_url, "https://configured.example.test/v1beta");
  assert.equal(resolved.api_key, "private");
});
