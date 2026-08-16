/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { projectToolFileDisplay, projectToolOperationSummary } from "../src/tool-presentation.js";

test("tool file display projects paths, resources, and attachment identities", () => {
  assert.equal(
    projectToolFileDisplay({ view: "workspace", path: "src/report.csv" }),
    "src/report.csv",
  );
  assert.equal(
    projectToolFileDisplay({
      view: "attachment",
      identity: { attachmentId: "att-report" },
    }),
    "attachment:att-report",
  );
  assert.equal(
    projectToolFileDisplay({ logical: { view: "workspace", path: "reports/result.json" } }),
    "reports/result.json",
  );
});

test("patch summaries describe invocation, result target, and failure", () => {
  assert.equal(
    projectToolOperationSummary("patch_file", {
      format: "apply_patch",
      dryRun: true,
      patch: "*** Begin Patch",
    }),
    "patch_file · apply_patch · dry-run",
  );
  assert.equal(
    projectToolOperationSummary(
      "patch_file",
      {
        dryRun: false,
        changes: [{ path: { view: "workspace", path: "src/index.js" }, action: "write" }],
      },
      { result: true },
    ),
    "patch_file · src/index.js",
  );
  assert.equal(
    projectToolOperationSummary(
      "patch_file",
      { error: "patch.newPath is outside the allowed scope" },
      { result: true },
    ),
    "patch_file · patch.newPath is outside the allowed scope",
  );
});

test("native script summaries describe declared inputs and published outputs", () => {
  assert.equal(
    projectToolOperationSummary("execute_native_script", {
      inputs: [{ source: "a.txt" }, { source: "b.txt" }],
      arguments: { phase: "probe" },
      script_body: "return true",
    }),
    "execute_native_script · 2 inputs · phase=probe",
  );
  assert.equal(
    projectToolOperationSummary(
      "execute_native_script",
      {
        output_file_count: 2,
        output_bytes: 161,
        transferEnvelopes: [
          {
            payload: {
              attachments: [{ name: "empty.bin" }, { name: "report.json" }],
            },
          },
        ],
      },
      { result: true },
    ),
    "execute_native_script · empty.bin, report.json · 161 B",
  );
  assert.equal(
    projectToolOperationSummary(
      "execute_native_script",
      { error: "inputs path is outside the allowed scope" },
      { result: true },
    ),
    "execute_native_script · inputs path is outside the allowed scope",
  );
});
