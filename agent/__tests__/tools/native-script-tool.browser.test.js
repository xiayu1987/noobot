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
import {
  IDENTITY,
  createRuntime,
  hasChromiumCapability,
} from "./native-script-tool.fixtures.js";

test("execute_native_script uses the installed Chromium path with an isolated task HOME", async (t) => {
  if (!(await hasChromiumCapability())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-browser-"));
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `browser-output-${index}`,
          sessionId: "session-1",
          attachmentSource: "model",
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: Buffer.from(artifact.contentBase64, "base64").length,
        }));
      },
    },
  });
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        arguments: {},
        script_body: `
const page = await browser.newPage();
await page.screenshot({ path: "browser/page.png" });
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal(persistedRequest.artifacts[0].name, "browser__page.png");
});

test("execute_native_script supports restricted offline browser content and page cleanup", async (t) => {
  if (!(await hasChromiumCapability())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-browser-content-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const page = await browser.newPage();
await page.setContent("<main><h1>Native browser ready</h1></main>");
log(await page.title(), await page.textContent("h1"));
await page.close();
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /Native browser ready/);
});

