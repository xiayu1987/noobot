/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_LAYOUT,
  WORKSPACE_RUNTIME_DIRECTORIES,
  WORKSPACE_OPERATION,
  WORKSPACE_SECTIONS,
  WORKSPACE_ASSET_SECTIONS,
  WORKSPACE_ASSET_ACTION,
  WORKSPACE_ASSET_REASON,
  isWorkspacePathSegment,
  isWorkspaceRuntimeRelativePath,
  normalizeWorkspaceSections,
  parseWorkspaceAssetState,
  planWorkspaceAssetSync,
  planWorkspaceLayoutMigrations,
  renderWorkspaceAssetState,
  resolvePluginDataRelativePath,
} from "../src/index.js";

const h = (char) => char.repeat(64);

test("layout runtime directories all live under runtime", () => {
  for (const dir of WORKSPACE_RUNTIME_DIRECTORIES) assert.ok(isWorkspaceRuntimeRelativePath(dir));
  assert.ok(WORKSPACE_RUNTIME_DIRECTORIES.includes(WORKSPACE_LAYOUT.PLUGIN_DATA_DIR));
});

test("plugin data path rejects traversal and invalid segments", () => {
  assert.equal(
    resolvePluginDataRelativePath("workflow", "session"),
    "runtime/plugin-data/workflow/session",
  );
  assert.throws(() => resolvePluginDataRelativePath("..", "x"), TypeError);
  assert.throws(() => resolvePluginDataRelativePath("workflow", "a/b"), TypeError);
  assert.equal(isWorkspacePathSegment("a..b"), false);
});

test("sections normalize and reject unknown names", () => {
  assert.deepEqual(normalizeWorkspaceSections(), Object.keys(WORKSPACE_SECTIONS));
  assert.deepEqual(normalizeWorkspaceSections([" Memory ", "memory"]), ["memory"]);
  assert.throws(() => normalizeWorkspaceSections(["template"]), {
    code: "WORKSPACE_SECTIONS_INVALID",
  });
  assert.deepEqual(WORKSPACE_ASSET_SECTIONS, ["service", "skill"]);
  for (const name of ["memory", "config", "service", "skill"]) {
    assert.equal(WORKSPACE_SECTIONS[name].backupOnReset, true);
  }
  assert.deepEqual(WORKSPACE_SECTIONS.config.retiredPaths, ["config.example.json"]);
});

test("asset state round-trips and rejects invalid documents", () => {
  const text = renderWorkspaceAssetState({
    files: { "skills/b.md": h("b"), "skills/a.md": h("a") },
  });
  assert.deepEqual(Object.keys(parseWorkspaceAssetState(text).files), [
    "skills/a.md",
    "skills/b.md",
  ]);
  assert.throws(() => parseWorkspaceAssetState("{"), { code: "WORKSPACE_ASSET_STATE_INVALID" });
  assert.throws(() => parseWorkspaceAssetState('{"version":2,"files":{}}'), {
    code: "WORKSPACE_ASSET_STATE_INVALID",
  });
  assert.throws(() => parseWorkspaceAssetState('{"version":1,"files":{"../x":"' + h("a") + '"}}'), {
    code: "WORKSPACE_ASSET_STATE_INVALID",
  });
});

test("sync upgrades pristine files, keeps user edits, removes retired pristine files", () => {
  const plan = planWorkspaceAssetSync({
    operation: WORKSPACE_OPERATION.SYNC,
    packageFiles: { new: h("1"), same: h("2"), pristine: h("3"), edited: h("4") },
    installedState: {
      version: 1,
      files: {
        same: h("2"),
        pristine: h("a"),
        edited: h("b"),
        retired: h("c"),
        retiredEdited: h("d"),
      },
    },
    userFiles: {
      same: h("2"),
      pristine: h("a"),
      edited: h("e"),
      retired: h("c"),
      retiredEdited: h("f"),
    },
  });
  const byPath = Object.fromEntries(plan.actions.map((item) => [item.relativePath, item]));
  assert.equal(byPath.new.action, WORKSPACE_ASSET_ACTION.INSTALL);
  assert.equal(byPath.same.reason, WORKSPACE_ASSET_REASON.UP_TO_DATE);
  assert.equal(byPath.pristine.action, WORKSPACE_ASSET_ACTION.UPDATE);
  assert.equal(byPath.edited.reason, WORKSPACE_ASSET_REASON.USER_MODIFIED);
  assert.equal(byPath.retired.action, WORKSPACE_ASSET_ACTION.REMOVE);
  assert.equal(byPath.retiredEdited, undefined);
  assert.deepEqual(plan.nextState.files, {
    new: h("1"),
    same: h("2"),
    pristine: h("3"),
    edited: h("b"),
  });
});

test("repair only installs missing files; create and reset install all", () => {
  const input = {
    packageFiles: { a: h("1"), b: h("2") },
    installedState: { version: 1, files: { a: h("1") } },
    userFiles: { a: h("9") },
  };
  const repair = planWorkspaceAssetSync({ ...input, operation: WORKSPACE_OPERATION.REPAIR });
  assert.deepEqual(
    repair.actions.map((item) => item.relativePath),
    ["b"],
  );
  assert.deepEqual(repair.nextState.files, { a: h("1"), b: h("2") });
  for (const operation of [WORKSPACE_OPERATION.CREATE, WORKSPACE_OPERATION.RESET]) {
    const plan = planWorkspaceAssetSync({ ...input, operation });
    assert.deepEqual(
      plan.actions.map((item) => item.action),
      ["install", "install"],
    );
    assert.deepEqual(plan.nextState.files, input.packageFiles);
  }
  assert.throws(() => planWorkspaceAssetSync({ operation: "copy" }), TypeError);
});

test("layout migration moves legacy plugin data and rejects conflicts", () => {
  const legacy = new Set(["runtime/workflow", "runtime/harness"]);
  const actions = planWorkspaceLayoutMigrations({ exists: (item) => legacy.has(item) });
  assert.deepEqual(
    actions.map((item) => [item.from, item.to, item.action]),
    [
      ["runtime/workflow", "runtime/plugin-data/workflow", "move"],
      ["runtime/harness", "runtime/plugin-data/harness", "move"],
    ],
  );
  assert.deepEqual(planWorkspaceLayoutMigrations({ exists: () => false }), []);
  assert.throws(() => planWorkspaceLayoutMigrations({ exists: () => true }), {
    code: "WORKSPACE_LAYOUT_MIGRATION_CONFLICT",
  });
});
