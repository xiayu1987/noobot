/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveToolBindingSettings } from "../src/index.js";

const settings = {
  toolIds: ["read_file", "search"],
  bindings: { read_file: { bindingName: "read_document" } },
};

test("binding settings inherit global names and user overrides without mutation", () => {
  const overrides = { read_file: { bindingName: "read_text" } };
  assert.deepEqual(resolveToolBindingSettings(settings, overrides), overrides);
  assert.equal(settings.bindings.read_file.bindingName, "read_document");
  assert.deepEqual(resolveToolBindingSettings(settings, {}), settings.bindings);
});

test("binding settings reject collisions with inherited and unchanged tool names", () => {
  for (const bindingName of ["read_document", "read_file", "", "invalid.name"]) {
    const overrides = { search: { bindingName } };
    if (bindingName === "read_file") {
      assert.throws(
        () => resolveToolBindingSettings({ toolIds: settings.toolIds }, overrides),
        /duplicate/,
      );
    } else {
      assert.throws(() => resolveToolBindingSettings(settings, overrides), /duplicate|invalid/);
    }
  }
});

test("binding settings preserve extension bindings and validate them with builtin names", () => {
  const overrides = { extension_tool: { bindingName: "extension_call" } };
  assert.equal(
    resolveToolBindingSettings(settings, overrides).extension_tool.bindingName,
    "extension_call",
  );
  assert.throws(
    () => resolveToolBindingSettings(settings, { extension_tool: { bindingName: "search" } }),
    /duplicate/,
  );
});
