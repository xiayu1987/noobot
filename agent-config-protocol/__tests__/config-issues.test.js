/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_REPAIR_ACTION,
  configIssueBlocksStartup,
  createConfigIssue,
  diagnoseConfigModelReferences,
  repairConfigDocument,
  requireConfigRepairRule,
  upgradeConfigModelLibrary,
  parseConfigDocumentText,
} from "../src/index.js";

test("repair allowlist permits declared enums but excludes model selection and tool identity changes", () => {
  const baseValues = { preferences: { language: "en-US" }, default_provider: "primary" };
  const target = {
    preferences: { language: "bad" },
    default_provider: "",
    tools: { bindings: { read_file: { bindingName: "bad.name" } } },
  };
  const result = repairConfigDocument({ baseValues, target });
  assert.equal(result.document.preferences.language, "en-US");
  assert.equal(result.document.default_provider, "");
  assert.deepEqual(result.document.tools.bindings, target.tools.bindings);
  assert.deepEqual(
    result.report.issues.map(({ code }) => code),
    ["MODEL_REFERENCE_NOT_FOUND", "INVALID_TOOL_BINDING_CONFIG"],
  );
  assert.ok(
    result.report.issues.every(
      (issue) => !configIssueBlocksStartup(issue, CONFIG_DOCUMENT_SCOPE.GLOBAL),
    ),
  );
  assert.throws(
    () =>
      requireConfigRepairRule(CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT, "model_capability_mismatch"),
    /undeclared config repair/,
  );
  assert.deepEqual(target.preferences, { language: "bad" });
  assert.equal(repairConfigDocument({ baseValues, target: result.document }).report.changed, false);
});

test("document failures isolate users, global document failures and unknown policies remain blocking", () => {
  const issue = createConfigIssue("INVALID_MODEL_LIBRARY_CONFIG", {
    path: "model_library_version",
  });
  assert.equal(configIssueBlocksStartup(issue, CONFIG_DOCUMENT_SCOPE.USER), false);
  assert.equal(configIssueBlocksStartup(issue, CONFIG_DOCUMENT_SCOPE.GLOBAL), true);
  assert.throws(() => createConfigIssue("UNCLASSIFIED"), /unclassified/);
  assert.throws(
    () => configIssueBlocksStartup({ code: "UNCLASSIFIED" }, CONFIG_DOCUMENT_SCOPE.USER),
    /invalid config issue impact/,
  );
  assert.throws(
    () => upgradeConfigModelLibrary({ model_library_version: "bad" }),
    (error) => {
      assert.equal(error.code, "INVALID_MODEL_LIBRARY_CONFIG");
      assert.equal(error.details.path, "model_library_version");
      return true;
    },
  );
});

test("optional empty model references are valid while required empty choices remain visible", () => {
  const issues = diagnoseConfigModelReferences({
    default_provider: "",
    scenarios: { definitions: { programming: { model: "" } } },
  });
  assert.deepEqual(
    issues.map(({ path }) => path),
    ["default_provider"],
  );
});

test("unreadable config documents cannot be automatically reset", () => {
  for (const source of ['{"secret":"do-not-log" trailing', "null", "[]", '"text"']) {
    assert.throws(
      () => parseConfigDocumentText(source),
      (error) => {
        assert.equal(error.code, "INVALID_CONFIG_DOCUMENT");
        assert.equal(error.message.includes("do-not-log"), false);
        assert.equal(configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.GLOBAL), true);
        assert.equal(configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.USER), false);
        return true;
      },
    );
  }
  assert.throws(() => repairConfigDocument({ target: null }), { code: "INVALID_CONFIG_DOCUMENT" });
});

test("protected security and administrator values are rejected, never reset", () => {
  for (const target of [
    { security: false },
    { security: { execution_isolation: { mode: "typo" } } },
    { security: { trusted_directories: 5 } },
    { super_admin: { user_id: false, connect_code: "secret" } },
  ]) {
    const original = structuredClone(target);
    assert.throws(
      () => repairConfigDocument({ target }),
      (error) => {
        assert.equal(error.code, "INVALID_SECURITY_CONFIG");
        assert.equal(configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.GLOBAL), true);
        return true;
      },
    );
    assert.deepEqual(target, original);
  }
});
