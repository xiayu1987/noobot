/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  projectToolOperationSubject,
  projectToolOperationSummary,
} from "../src/tool-presentation.js";

test("operation subject is the summary without the tool name prefix", () => {
  const args = { command: "npm test" };
  assert.equal(projectToolOperationSubject("execute_script", args), "npm test");
  assert.equal(projectToolOperationSummary("execute_script", args), "execute_script · npm test");
  assert.equal(projectToolOperationSubject("execute_script", {}), "");
  assert.equal(projectToolOperationSummary("execute_script", {}), "execute_script");
});

test("file tool subjects project args strings and result path references by view", () => {
  assert.equal(projectToolOperationSubject("read_file", { filePath: "src/a.js" }), "src/a.js");
  const subject = (detail) => projectToolOperationSubject("read_file", detail, { result: true });
  assert.equal(
    subject({ ok: true, path: { view: "workspace", path: "src/report.csv" } }),
    "src/report.csv",
  );
  assert.equal(
    subject({ ok: true, path: { view: "host", path: "/srv/data/a.txt" } }),
    "/srv/data/a.txt",
  );
  assert.equal(
    subject({ ok: true, path: { view: "mount", mount: "/shared-write", path: "out/a.txt" } }),
    "/shared-write/out/a.txt",
  );
  assert.equal(
    subject({
      ok: true,
      path: { view: "attachment", attachmentRef: "attachment:v1:s/model/a" },
      fileName: "report.xlsx",
    }),
    "report.xlsx",
  );
  assert.equal(
    subject({ ok: false, error: "denied", code: "RECOVERABLE_PATH_OUT_OF_SCOPE" }),
    "denied",
  );
});

test("search subjects show the searched directory reference including the workspace root", () => {
  assert.equal(
    projectToolOperationSummary("search", { query: "foo", path: "src" }),
    "search · foo · src",
  );
  assert.equal(
    projectToolOperationSummary(
      "search",
      {
        ok: true,
        query: "foo",
        source: "files",
        path: { view: "workspace", path: "." },
        matches: [],
      },
      { result: true },
    ),
    "search · foo · . · 0 matches",
  );
  assert.equal(
    projectToolOperationSummary(
      "search",
      { ok: true, query: "foo", source: "text", matches: [{}] },
      { result: true },
    ),
    "search · foo · 1 matches",
  );
});

test("overflowed results show the overflow message for every tool", () => {
  const overflow = {
    ok: true,
    message: "result moved to a source reference",
    overflowed: true,
    transferEnvelopes: [],
  };
  for (const tool of ["read_file", "patch_file", "search", "execute_script"]) {
    assert.equal(
      projectToolOperationSubject(tool, overflow, { result: true }),
      "result moved to a source reference",
    );
  }
});

test("non-canonical tool path references are rejected instead of displayed", () => {
  const subject = (detail) => projectToolOperationSubject("read_file", detail, { result: true });
  assert.throws(() => subject({ path: "src/a.js" }), TypeError);
  assert.throws(() => subject({ path: { logical: { view: "workspace", path: "a" } } }), TypeError);
  assert.throws(() => subject({ path: { view: "mount", path: "a" } }), TypeError);
  assert.throws(
    () => subject({ path: { view: "attachment", attachmentRef: "attachment:v1:s/model/a" } }),
    TypeError,
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
        ok: true,
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
      {
        ok: false,
        error: "patch.newPath is outside the allowed scope",
        code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
      },
      { result: true },
    ),
    "patch_file · patch.newPath is outside the allowed scope",
  );
});

test("successful patch results without changes are rejected instead of displayed", () => {
  const subject = (detail) => projectToolOperationSubject("patch_file", detail, { result: true });
  assert.throws(() => subject({ ok: true, dryRun: true }), TypeError);
  assert.throws(() => subject({ ok: true, dryRun: true, changes: [] }), TypeError);
});

test("failure is decided by ok, not by the presence of error", () => {
  assert.equal(
    projectToolOperationSubject(
      "read_file",
      { ok: true, error: "stale", path: { view: "workspace", path: "a.js" } },
      { result: true },
    ),
    "a.js",
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
        ok: true,
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
      {
        ok: false,
        error: "inputs path is outside the allowed scope",
        code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
      },
      { result: true },
    ),
    "execute_native_script · inputs path is outside the allowed scope",
  );
});
