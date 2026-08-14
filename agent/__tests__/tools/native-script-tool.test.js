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

const IDENTITY = Object.freeze({
  transferId: "transfer:native-script:output",
  messageId: "message:native-script",
  sessionId: "session-1",
  turnScopeId: "turn:native-script",
  runId: "run:native-script",
  producer: { type: "tool", id: "call:native-script" },
});

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

function createRuntime(basePath, patch = {}) {
  return {
    basePath,
    userId: "admin",
    globalConfig: { tools: { execute_native_script: { enabled: true } } },
    userConfig: {},
    systemRuntime: {
      sessionId: "session-1",
      rootSessionId: "session-1",
      config: { safeConfirm: false },
    },
    ...patch,
  };
}

test("execute_native_script injects capabilities and persists task output", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-script-"));
  await fs.writeFile(path.join(basePath, "input.txt"), "source", "utf8");
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `native-output-${index}`,
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
  assert.match(tool.schema.shape.script_body.description, /await output\.file\(/);
  assert.match(tool.schema.shape.script_body.description, /await output\.tempFile\(/);
  assert.match(tool.schema.shape.script_body.description, /await output\.tempDirectory\(/);
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "input.txt" }],
        arguments: { suffix: "done" },
        script_body: `
const inputFile = await files.input(0);
const outputFile = await output.file("report/result.txt");
const source = await files.readText(inputFile);
await files.writeText(outputFile, source + ":" + args.suffix);
log("completed");
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.isolation, "host_restricted");
  assert.equal(result.path_view, "task-local");
  assert.equal(result.output_file_count, 1);
  assert.match(result.stdout, /completed/);
  assert.equal(persistedRequest.generationSource, "execute_native_script");
  assert.equal(persistedRequest.artifacts[0].name, "report__result.txt");
  assert.equal(
    Buffer.from(persistedRequest.artifacts[0].contentBase64, "base64").toString(),
    "source:done",
  );
  const taskRoot = path.join(basePath, "runtime", "native_tasks");
  assert.deepEqual(await fs.readdir(taskRoot), []);
});

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

test("execute_native_script uses the installed Chromium path with an isolated task HOME", async () => {
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

test("execute_native_script supports restricted offline browser content and page cleanup", async () => {
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

test("execute_native_script resolves FFmpeg output tokens into collected binary attachments", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-ffmpeg-"));
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `ffmpeg-${index}`,
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
        script_body: `
const target = await output.file("media/generated.wav");
await ffmpeg.run({ args: ["-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", target] });
const probe = await ffprobe.run({ args: ["-v", "error", "-show_entries", "format=format_name", "-of", "default=noprint_wrappers=1", target] });
log(probe.stdout);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal(persistedRequest.artifacts[0].name, "media__generated.wav");
  assert.ok(Buffer.from(persistedRequest.artifacts[0].contentBase64, "base64").length > 44);
  assert.equal(persistedRequest.artifacts[0].meta.virtualPath, "output://media/generated.wav");
  assert.match(result.stdout, /format_name=wav/);
  assert.doesNotMatch(result.stderr, /\/tmp\/noobot-native-|runtime\/native_tasks/);
});

test("execute_native_script fails when LibreOffice reports success without an output artifact", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-libreoffice-"));
  await fs.writeFile(path.join(basePath, "input.html"), "<html><body>test</body></html>", "utf8");
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "input.html" }],
        script_body: `
const source = await files.input(0);
await libreoffice.convert({ input: source, outputDirectory: output.directory, outputFormat: "not_a_real_format" });
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.output_file_count, 0);
  assert.match(result.stderr, /LibreOffice conversion/);
  assert.doesNotMatch(result.stderr, /\/tmp\/noobot-native-|runtime\/native_tasks|\/home\/xiayu/);
});

test("execute_native_script converts a declared input token with LibreOffice", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-libreoffice-input-"));
  await fs.writeFile(
    path.join(basePath, "input.html"),
    "<html><body><h1>Native document</h1><p>Input token conversion</p></body></html>",
    "utf8",
  );
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `libreoffice-${index}`,
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
        inputs: [{ source: "input.html" }],
        script_body: `
const source = await files.input(0);
const converted = await libreoffice.convert({
  input: source,
  outputDirectory: output.directory,
  outputFormat: "docx",
});
log(converted.output, converted.outputBytes);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal(persistedRequest.artifacts[0].name, "0.docx");
  assert.ok(Buffer.from(persistedRequest.artifacts[0].contentBase64, "base64").length > 0);
  assert.match(result.stdout, /output:\/\/0\.docx/);
});

test("execute_native_script converts a same-task output token with LibreOffice", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-libreoffice-output-"));
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `libreoffice-output-${index}`,
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
        script_body: `
const source = await output.file("source.html");
await files.writeText(source, "<html><body><h1>Same task</h1></body></html>");
const converted = await libreoffice.convert({
  input: source,
  outputDirectory: output.directory,
  outputFormat: "docx",
});
log(converted.output);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 2);
  assert.deepEqual(persistedRequest.artifacts.map((artifact) => artifact.name).sort(), [
    "source.docx",
    "source.html",
  ]);
  assert.match(result.stdout, /output:\/\/source\.docx/);
});

test("execute_native_script projects runtime roots but preserves caller path data", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-redaction-"));
  await fs.writeFile(path.join(basePath, "input.txt"), "source", "utf8");
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `redaction-${index}`,
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
        inputs: [{ source: "input.txt" }],
        arguments: { nested: { hostPath: "/home/private/source.txt" } },
        script_body: `
const source = await files.input(0);
const target = await output.file("reports/paths.json");
log({ source, target, nested: args.nested });
await files.writeJson(target, { source, target, nested: args.nested });
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /input:\/\/0/);
  assert.match(result.stdout, /output:\/\/reports\/paths\.json/);
  assert.match(result.stdout, /\/home\/private\/source\.txt/);
  const persistedJson = Buffer.from(persistedRequest.artifacts[0].contentBase64, "base64").toString(
    "utf8",
  );
  assert.deepEqual(JSON.parse(persistedJson), {
    source: "input://0",
    target: "output://reports/paths.json",
    nested: { hostPath: "/home/private/source.txt" },
  });
});

test("execute_native_script reads generated output and temporary text through task paths", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-readback-"));
  let persistedRequest = null;
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        persistedRequest = request;
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `readback-${index}`,
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
        script_body: `
const temporary = await output.tempFile("intermediate.json");
await ffmpeg.run({ args: ["-f", "lavfi", "-i", "anullsrc=duration=0.01", "-f", "ffmetadata", temporary] });
const generated = await output.file("result.json");
await files.writeJson(generated, { status: "ready" });
const parsed = await files.readJson(generated);
const temporaryText = await files.readText(temporary);
log(parsed.status, temporaryText);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /ready/);
  assert.match(result.stdout, /FFMETADATA/);
  assert.equal(persistedRequest.artifacts.length, 1);
  assert.equal(persistedRequest.artifacts[0].name, "result.json");
});

test("execute_native_script writes and reads temporary text and JSON without collecting attachments", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-temp-write-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const temporaryText = await output.tempFile("temporary.txt");
const temporaryJson = await output.tempFile("temporary.json");
await files.writeText(temporaryText, "temporary-content");
await files.writeJson(temporaryJson, { status: "ready" });
log(await files.readText(temporaryText), (await files.readJson(temporaryJson)).status);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /temporary-content ready/);
  assert.equal(result.output_file_count, 0);
  assert.deepEqual(result.transferEnvelopes, []);
});

test("execute_native_script converts into an explicit temporary LibreOffice directory", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-libreoffice-temp-"));
  await fs.writeFile(
    path.join(basePath, "input.html"),
    "<html><body><h1>Temporary PDF</h1></body></html>",
    "utf8",
  );
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "input.html" }],
        script_body: `
const source = await files.input(0);
const temporaryDirectory = await output.tempDirectory("libreoffice-output");
const converted = await libreoffice.convert({
  input: source,
  outputDirectory: temporaryDirectory,
  outputFormat: "pdf",
});
log(converted.output, (await files.readText(converted.output)).length);
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /temp:\/\/libreoffice-output\/0\.pdf/);
  assert.doesNotMatch(result.stderr, /output:\/\/temp:/);
  assert.equal(result.output_file_count, 0);
  assert.deepEqual(result.transferEnvelopes, []);
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

test("execute_native_script accepts a complete model attachment identity", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-attachment-input-"));
  const attachmentPath = path.join(
    basePath,
    "runtime",
    "attach",
    "scoped",
    "session-1",
    "model",
    "source.txt",
  );
  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(attachmentPath, "attachment source", "utf8");
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async getAttachmentById(identity) {
        assert.deepEqual(identity, {
          userId: "admin",
          attachmentId: "model-source",
          sessionId: "session-1",
          attachmentSource: "model",
        });
        return {
          ...identity,
          absolutePath: attachmentPath,
          path: attachmentPath,
          mimeType: "text/plain",
        };
      },
      async ingestGeneratedArtifacts(request) {
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `attachment-result-${index}`,
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
        inputs: [
          {
            source: {
              attachmentId: "model-source",
              sessionId: "session-1",
              attachmentSource: "model",
            },
          },
        ],
        script_body: `
const source = await files.input(0);
const target = await output.file("copied.txt");
await files.writeText(target, await files.readText(source));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
});

test("execute_native_script accepts a logical workspace path", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-resource-ref-"));
  const inputPath = path.join(basePath, "resource-input.txt");
  await fs.writeFile(inputPath, "resource identity", "utf8");
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
  const scope = createTestAgentExecutionScope(runtime);
  const [tool] = createNativeScriptTool({ agentContext: scope });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "resource-input.txt" }],
        script_body: `
const input = await files.input(0);
const target = await output.file("resource-copy.txt");
await files.writeText(target, await files.readText(input));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].source, "attachment");
});

test("execute_native_script projects a sandbox workspace path into task-local input", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-sandbox-input-"));
  await fs.writeFile(path.join(basePath, "sandbox-input.txt"), "shared resource", "utf8");
  const runtime = createRuntime(basePath, {
    globalConfig: {
      tools: { execute_native_script: { enabled: true } },
      security: {
        executionIsolation: {
          mode: "sandbox",
          sandbox: { provider: "docker", scope: "user" },
        },
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `sandbox-output-${index}`,
          sessionId: "session-1",
          attachmentSource: "model",
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: Buffer.from(artifact.contentBase64, "base64").length,
        }));
      },
    },
  });
  const [tool] = createNativeScriptTool({
    agentContext: createTestAgentExecutionScope(runtime),
  });
  const result = JSON.parse(
    await tool.invoke(
      {
        inputs: [{ source: "/workspace/sandbox-input.txt" }],
        script_body: `
const input = await files.input(0);
const target = await output.file("sandbox-copy.txt");
await files.writeText(target, await files.readText(input));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal(result.path_view, "task-local");
});

test("execute_native_script browser rejects non-HTTP navigation protocols", async () => {
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

test("execute_native_script is absent unless global configuration explicitly enables it", () => {
  const runtime = createRuntime("/tmp/noobot-native-disabled", {
    globalConfig: { tools: { execute_native_script: { enabled: false } } },
  });
  assert.deepEqual(
    createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) }),
    [],
  );
});
