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
  assert.match(tool.schema.shape.inputs.description, /\{ source:/);
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
  assert.deepEqual(result.execution, {
    view: "native_host_restricted",
    provider: "host",
  });
  assert.equal("path_view" in result, false);
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

test("execute_native_script joins a temp directory token with a file name exactly once", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-temp-directory-"));
  const runtime = createRuntime(basePath);
  const [tool] = createNativeScriptTool({ agentContext: createTestAgentExecutionScope(runtime) });
  const result = JSON.parse(
    await tool.invoke(
      {
        script_body: `
const directory = await output.tempDirectory("nested");
const temporary = await output.tempFile(directory, "report.txt");
await files.writeText(temporary, "ready");
log(temporary, await files.readText(temporary));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stdout, /temp:\/\/nested\/report\.txt ready/);
  assert.doesNotMatch(result.stdout, /temp:\/\/temp:\/\//);
});

test("execute_native_script publishes zero-byte output with the same count as its attachments", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-empty-output-"));
  const runtime = createRuntime(basePath, {
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `empty-output-${index}`,
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
const target = await output.file("empty.bin");
await files.writeText(target, "");
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal(result.output_bytes, 0);
  assert.equal(result.transferEnvelopes[0].payload.attachments.length, 1);
  assert.equal(result.transferEnvelopes[0].payload.attachments[0].name, "empty.bin");
  assert.equal(result.transferEnvelopes[0].payload.attachments[0].size, 0);
});

