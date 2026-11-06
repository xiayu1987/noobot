/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DOCUMENT_SCOPE, mergeConfig, repairConfigDocument } from "../src/index.js";

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

test("repair rejects invalid binding declarations instead of deleting or defaulting them", () => {
  for (const bindingName of ["", "invalid.name", null, 42]) {
    assert.throws(
      () =>
        repairConfigDocument({
          scope: CONFIG_DOCUMENT_SCOPE.USER,
          baseValues: globalConfig,
          target: { tools: { bindings: { read_file: { bindingName } } } },
        }),
      /invalid tool bindingName/,
    );
  }
});

test("effective config rejects collisions introduced across global and user scopes", () => {
  assert.throws(
    () =>
      mergeConfig(globalConfig, {
        tools: { bindings: { read_file: { bindingName: "global_search" } } },
      }),
    /duplicate tool bindingName/,
  );
});
