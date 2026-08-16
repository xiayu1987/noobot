/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNativeScriptTool } from "../../src/tools/execution/native-script-tool.js";
import {
  buildLibreOfficeUserInstallationUrl,
  resolveLibreOfficeOutputFormat,
  resolveBrowserProxyFromEnv,
} from "../../src/tools/execution/native-script-runtime.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import { IDENTITY, createRuntime } from "./native-script-tool.fixtures.js";

test("native browser proxy derives Playwright options without exposing its URL", () => {
  assert.deepEqual(
    resolveBrowserProxyFromEnv({
      HTTPS_PROXY: "http://user:secret@127.0.0.1:7890/",
      NO_PROXY: "localhost,127.0.0.1",
    }),
    {
      server: "http://127.0.0.1:7890",
      username: "user",
      password: "secret",
      bypass: "localhost,127.0.0.1",
    },
  );
  assert.equal(resolveBrowserProxyFromEnv({}), undefined);
});

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

test("execute_native_script is absent unless global configuration explicitly enables it", () => {
  const runtime = createRuntime("/tmp/noobot-native-disabled", {
    globalConfig: { tools: { execute_native_script: { enabled: false } } },
  });
  assert.deepEqual(
    createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) }),
    [],
  );
});

