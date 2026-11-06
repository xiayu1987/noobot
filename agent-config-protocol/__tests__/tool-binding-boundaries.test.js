/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DOCUMENT_SCOPE, mergeConfig, repairConfigDocument } from "../src/index.js";
import { sanitizeUserConfig } from "../src/policy/user-override.js";

const globalConfig = { tools: { bindings: { read_file: { bindingName: "global_read" } } } };

test("raw binding declarations are validated before user projection or merging", () => {
  for (const entry of [null, "", 42, {}, { bindingName: "ok", extra: true }, { bindingName: "" }]) {
    const input = { tools: { bindings: { read_file: entry } } };
    assert.throws(() => sanitizeUserConfig(input), /bindingName/);
    assert.throws(() => mergeConfig(globalConfig, input), /bindingName/);
    assert.throws(() => mergeConfig(input), /bindingName/);
    assert.throws(() => repairConfigDocument({ target: input }), /bindingName/);
    assert.throws(() => repairConfigDocument({ baseValues: input }), /bindingName/);
  }
  for (const bindings of [null, "", 42, []]) {
    assert.throws(() => mergeConfig(globalConfig, { tools: { bindings } }), /bindings/);
  }
});

test("dynamic tool identities survive normalization, repair and user projection", () => {
  const bindings = {
    ["__proto__"]: { bindingName: "prototype_identity" },
    constructor: { bindingName: "constructor_identity" },
    toString: { bindingName: "string_identity" },
    user_id: { bindingName: "snake_identity" },
    userId: { bindingName: "camel_identity" },
    script_timeout_ms: { bindingName: "timeout_identity" },
  };
  const config = { tools: { bindings } };
  assert.deepEqual(mergeConfig(config).tools.bindings, bindings);
  assert.deepEqual(mergeConfig({}, config).tools.bindings, bindings);
  assert.deepEqual(sanitizeUserConfig(config).tools.bindings, bindings);
  assert.deepEqual(
    repairConfigDocument({ scope: CONFIG_DOCUMENT_SCOPE.USER, target: config }).document.tools
      .bindings,
    bindings,
  );
});
