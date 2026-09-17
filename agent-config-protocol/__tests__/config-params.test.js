/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertConfigParamsDocumentKeys,
  buildConfigParamCatalog,
  CONFIG_ERROR_CODE,
  createConfigValueLookup,
  mergeConfigParamLayers,
  normalizeConfigParamsDocument,
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

test("config params document preserves valid keys outside the current template", () => {
  assert.deepEqual(
    assertConfigParamsDocumentKeys(
      {
        values: { api_key: "secret" },
        descriptions: { api_key: "Credential" },
      },
      ["API_KEY", "REGION"],
    ),
    {
      values: { API_KEY: "secret" },
      descriptions: { API_KEY: "Credential" },
    },
  );
  assert.deepEqual(
    assertConfigParamsDocumentKeys({ values: { UNUSED_KEY: "value" } }, ["API_KEY"]),
    { values: { UNUSED_KEY: "value" }, descriptions: { UNUSED_KEY: "" } },
  );
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
});
