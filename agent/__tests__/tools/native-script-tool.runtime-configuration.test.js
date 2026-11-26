/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import { createNativeScriptTool } from "../../src/tools/execution/native-script-tool.js";
import {
  buildLibreOfficeUserInstallationUrl,
  createNativeScriptRuntime,
  resolveLibreOfficeOutputFormat,
} from "../../src/tools/execution/native-script-runtime.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { createRuntime } from "./native-script-tool.fixtures.js";

test("native LibreOffice profile uses an encoded file URL", () => {
  const value = buildLibreOfficeUserInstallationUrl(
    path.join(os.tmpdir(), "Noobot Native Profile #1"),
  );
  assert.equal(new URL(value).protocol, "file:");
  assert.match(value, /Noobot%20Native%20Profile%20%231\/libreoffice-profile$/);
});

test("native LibreOffice uses authoritative Office Open XML export filters", () => {
  assert.deepEqual(resolveLibreOfficeOutputFormat("docx"), {
    extension: "docx",
    convertTo: "docx:Office Open XML Text",
  });
  assert.deepEqual(resolveLibreOfficeOutputFormat("xlsx"), {
    extension: "xlsx",
    convertTo: "xlsx:Calc MS Excel 2007 XML",
  });
  assert.deepEqual(resolveLibreOfficeOutputFormat("pptx"), {
    extension: "pptx",
    convertTo: "pptx:Impress MS PowerPoint 2007 XML",
  });
});

test("LibreOffice success cannot publish a missing or empty converted artifact", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-office-artifact-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputRoot = path.join(root, "input");
  const outputRoot = path.join(root, "output");
  await fs.mkdir(inputRoot);
  await fs.writeFile(path.join(inputRoot, "0"), "<html>input</html>");
  const calls = [];
  const mocked = t.mock.method(childProcess, "execFile", (command, args, options, callback) => {
    calls.push({ command, args, options });
    queueMicrotask(() => callback(null, "", ""));
    return {};
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
  const runtime = await createNativeScriptRuntime({
    inputRoot,
    outputRoot,
    tempRoot: path.join(root, "temp"),
    inputMap: { 0: "0" },
    timeoutMs: 30000,
    libreOfficeExecutable: "office-test-command",
  });
  for (const emptyFile of [false, true]) {
    if (emptyFile) await fs.writeFile(path.join(outputRoot, "0.pdf"), "");
    await assert.rejects(
      runtime.capabilities.libreoffice.convert({
        input: "input://0",
        outputDirectory: runtime.capabilities.output.directory,
        outputFormat: "pdf",
      }),
      /LibreOffice conversion produced no non-empty output/,
    );
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === "office-test-command"));
});

test("execute_native_script is absent when effective configuration disables it", () => {
  const runtime = createRuntime("/tmp/noobot-native-disabled", {
    globalConfig: { tools: { execute_native_script: { enabled: false } } },
  });
  assert.deepEqual(
    createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) }),
    [],
  );
});
