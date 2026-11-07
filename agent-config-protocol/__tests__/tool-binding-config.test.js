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
import { createToolNameBinding } from "@noobot/model-protocol";

const globalConfig = {
  tools: {
    bindings: {
      read_file: { bindingName: "global_read" },
      search: { bindingName: "global_search" },
    },
  },
};

test("binding config survives repair and user overrides preserve unrelated global bindings", () => {
  const userConfig = { tools: { bindings: { read_file: { bindingName: "user_read" } } } };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues: globalConfig,
    target: userConfig,
  }).document;
  assert.equal(repaired.tools.bindings.read_file.bindingName, "user_read");
  const effective = mergeConfig(globalConfig, userConfig);
  assert.deepEqual(effective.tools.bindings, {
    read_file: { bindingName: "user_read" },
    search: { bindingName: "global_search" },
  });
  assert.equal(globalConfig.tools.bindings.read_file.bindingName, "global_read");
});

test("repair preserves invalid bindings and reports operation issues instead of renaming tools", () => {
  for (const bindingName of ["", "invalid.name", null, 42]) {
    const repaired = repairConfigDocument({
      scope: CONFIG_DOCUMENT_SCOPE.USER,
      baseValues: globalConfig,
      target: { tools: { bindings: { read_file: { bindingName } } } },
    });
    assert.equal(repaired.document.tools.bindings.read_file.bindingName, bindingName);
    assert.deepEqual(
      repaired.report.issues.map(({ code, impact, autoRepair }) => ({ code, impact, autoRepair })),
      [{ code: "INVALID_TOOL_BINDING_CONFIG", impact: "operation", autoRepair: false }],
    );
    assert.throws(
      () => createToolNameBinding({ bindings: repaired.document.tools.bindings }),
      /invalid tool bindingName/,
    );
  }
});

test("effective binding collisions are visible for correction and rejected before tool invocation", () => {
  const user = {
    tools: { bindings: { read_file: { bindingName: "global_search" } } },
  };
  const effective = mergeConfig(globalConfig, user);
  assert.equal(diagnoseConfigDocument(effective)[0].code, "INVALID_TOOL_BINDING_CONFIG");
  assert.throws(
    () => createToolNameBinding({ bindings: effective.tools.bindings }),
    /duplicate tool bindingName/,
  );
  user.tools.bindings.read_file.bindingName = "corrected_read";
  assert.deepEqual(diagnoseConfigDocument(mergeConfig(globalConfig, user)), []);
  assert.doesNotThrow(() =>
    createToolNameBinding({ bindings: mergeConfig(globalConfig, user).tools.bindings }),
  );
});
