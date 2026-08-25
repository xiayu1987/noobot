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
import { resolveFileInput } from "../../src/tools/core/file-input.js";

test("execute_native_script resolves a canonical attachment reference", async () => {
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
        inputs: [{ source: "attachment:v1:session-1/model/model-source" }],
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

test("execute_native_script rejects model-authored attachment identity objects", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-invalid-identity-"));
  const [tool] = createNativeScriptTool({
    agentContext: createTestAgentExecutionScope(createRuntime(basePath)),
  });

  await assert.rejects(
    tool.invoke(
      {
        inputs: [
          {
            source: {
              attachmentId: "model-source",
              sessionId: "wrong-session",
              attachmentSource: "model",
            },
          },
        ],
        script_body: "return null;",
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
    /Expected string|expected string/i,
  );
});

test("file input resolver rejects non-string sources at its own boundary", async () => {
  await assert.rejects(
    resolveFileInput({
      source: {
        attachmentId: "model-source",
        sessionId: "wrong-session",
        attachmentSource: "model",
      },
      fieldName: "inputs",
    }),
    /inputs source must be a string/,
  );
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
  assert.equal("path_view" in result, false);
});

test("execute_native_script projects a global sandbox mount into task-local input", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-mount-workspace-"));
  const mountedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-native-mount-source-"));
  await fs.writeFile(path.join(mountedRoot, "mounted-input.txt"), "mounted resource", "utf8");
  const runtime = createRuntime(basePath, {
    globalConfig: {
      tools: { execute_native_script: { enabled: true } },
      security: {
        executionIsolation: {
          mode: "sandbox",
          sandbox: {
            provider: "docker",
            scope: "user",
            mounts: [{ source: mountedRoot, target: "/shared-native", readOnly: true }],
          },
        },
      },
    },
    attachmentService: {
      async ingestGeneratedArtifacts(request) {
        return request.artifacts.map((artifact, index) => ({
          attachmentId: `mounted-output-${index}`,
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
        inputs: [{ source: "/shared-native/mounted-input.txt" }],
        script_body: `
const input = await files.input(0);
const target = await output.file("mounted-copy.txt");
await files.writeText(target, await files.readText(input));
`,
      },
      { configurable: { transferIdentity: IDENTITY } },
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.output_file_count, 1);
  assert.equal("path_view" in result, false);
});
