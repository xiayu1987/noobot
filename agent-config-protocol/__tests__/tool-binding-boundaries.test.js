/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_DOCUMENT_SCOPE,
  diagnoseConfigDocument,
  mergeConfig,
  repairConfigDocument,
} from "../src/index.js";
import { sanitizeUserConfig } from "../src/policy/user-override.js";

const globalConfig = { tools: { bindings: { read_file: { bindingName: "global_read" } } } };

test("invalid raw binding declarations survive projection for diagnosis and correction", () => {
  for (const entry of [null, "", 42, {}, { bindingName: "ok", extra: true }, { bindingName: "" }]) {
    const input = { tools: { bindings: { read_file: entry } } };
    assert.deepEqual(sanitizeUserConfig(input).tools.bindings.read_file, entry);
    assert.deepEqual(mergeConfig({}, input).tools.bindings.read_file, entry);
    for (const repaired of [
      repairConfigDocument({ target: input }),
      repairConfigDocument({ baseValues: input }),
    ]) {
      assert.deepEqual(repaired.document.tools.bindings.read_file, entry);
      assert.equal(repaired.report.issues[0].code, "INVALID_TOOL_BINDING_CONFIG");
    }
  }
  for (const bindings of [null, "", 42, []]) {
    const effective = mergeConfig(globalConfig, { tools: { bindings } });
    assert.deepEqual(effective.tools.bindings, bindings);
    assert.equal(diagnoseConfigDocument(effective)[0].code, "INVALID_TOOL_BINDING_CONFIG");
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
