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

