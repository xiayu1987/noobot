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

test("execute_native_script rejects host runtime escape syntax before execution", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-script-guard-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });

  for (const scriptBody of [
    'await import("node:fs")',
    "log(process.env)",
    "log({}.constructor)",
    "const key = args.key; log({}[key])",
  ]) {
    await assert.rejects(
      () =>
        tool.invoke({ script_body: scriptBody }, { configurable: { transferIdentity: IDENTITY } }),
      /forbidden/,
    );
  }
});

test("execute_native_script reports the source location of forbidden dynamic property access", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-script-location-"));
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `resource-output-${index}`,
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

  await assert.rejects(
    () =>
      tool.invoke(
        {
          script_body: [
            "const values = { safe: 1 };",
            'const key = "safe";',
            "log(values.safe);",
            "log(values[key]);",
          ].join("\n"),
        },
        { configurable: { transferIdentity: IDENTITY } },
      ),
    /forbidden dynamic property access at line 4, column 5/,
  );
});

test("execute_native_script rejects non-canonical capability call signatures", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-signature-"));
  await fs.writeFile(path.join(basePath, "input.html"), "<p>source</p>", "utf8");
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });

  const cases = [
    {
      script_body: `await ffmpeg.run(["-version"]);`,
      expected: /ffmpeg\.run\(\{ args \}\) requires one options object/,
    },
    {
      script_body: `await ffprobe.run({ args: [] });`,
      expected: /ffprobe\.run\(\{ args \}\) requires a non-empty args array/,
    },
    {
      inputs: [{ source: "input.html" }],
      script_body: `const source = await files.input(0); await libreoffice.convert(source);`,
      expected: /libreoffice\.convert.*requires one options object/,
    },
  ];
  for (const item of cases) {
    const result = JSON.parse(
      await tool.invoke(item, { configurable: { transferIdentity: IDENTITY } }),
    );
    assert.equal(result.ok, false);
    assert.match(result.stderr, item.expected);
  }
});

test("execute_native_script rejects output traversal before creating parent directories", async () => {
  const parentPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-output-traversal-"));
  const basePath = path.join(parentPath, "workspace");
  await fs.mkdir(basePath);
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const target = await output.file("../../../unauthorized-parent/result.txt");
await files.writeText(target, "must not exist");
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.stderr, /output path must be a safe relative path without parent traversal/);
  assert.equal(result.error, result.stderr.trim());
  await assert.rejects(fs.access(path.join(parentPath, "unauthorized-parent")));
});

test("execute_native_script rejects reversed tempFile arguments", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-temp-order-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const directory = await output.tempDirectory("nested");
await output.tempFile("report.txt", directory);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, false);
  assert.match(result.stderr, /requires tempDirectoryToken before fileName/);
  assert.doesNotMatch(result.stderr, /temp:\/\/report\.txt\/temp:\/\//);
});

test("execute_native_script rejects a temporary file token as LibreOffice outputDirectory", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-libreoffice-file-dir-"));
  await fs.writeFile(path.join(basePath, "input.html"), "<p>source</p>", "utf8");
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "input.html" }],
        script_body: `
const source = await files.input(0);
const temporaryFile = await output.tempFile("libreoffice-output");
await libreoffice.convert({
  input: source,
  outputDirectory: temporaryFile,
  outputFormat: "pdf",
});
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, false);
  assert.match(
    result.stderr,
    /outputDirectory requires output\.directory or output\.tempDirectory/,
  );
  assert.doesNotMatch(result.stderr, /output:\/\/temp:/);
});

test("execute_native_script requires task paths for file reads and output tokens for writes", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-file-protocol-"));
  await fs.writeFile(path.join(basePath, "input.txt"), "source", "utf8");
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });

  for (const scriptBody of [
    "await files.readText(0)",
    'await files.writeText("result.txt", "value")',
  ]) {
    const result = JSON.parse(
      await tool.invoke(
        { inputs: [{ source: "input.txt" }], script_body: scriptBody },
        { configurable: { transferIdentity: IDENTITY } },
      ),
    );
    assert.equal(result.ok, false);
    assert.match(result.stderr, /task path|output:\/\//);
  }
});

test("execute_native_script discards formal outputs when the script fails", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-failed-output-"));
  let persistCalls = 0;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts() {
        persistCalls += 1;
        return [];
      },
    },
  });
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const target = await output.file("partial.txt");
await files.writeText(target, "partial");
throw new Error("intentional failure");
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, false);
  assert.equal(result.output_file_count, 0);
  assert.equal(result.output_bytes, 0);
  assert.deepEqual(result.transferEnvelopes, []);
  assert.equal(persistCalls, 0);
});

test("execute_native_script exposes opaque capability callables", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-opaque-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
log(String(files.readText));
log(String(browser.newPage));
log(String(ffmpeg.run));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /native code/);
  assert.doesNotMatch(
    result.stdout,
    /resolveReadable|runCapability|browserExecutablePath|inputRoot|outputRoot/,
  );
});

test("execute_native_script browser rejects non-HTTP navigation protocols", async (t) => {
  if (!(await hasChromiumCapability())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-browser-protocol-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const page = await browser.newPage();
await page.goto("file:///etc/passwd");
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );
  assert.equal(result.ok, false);
  assert.match(result.stderr, /HTTP\(S\)/);
});

