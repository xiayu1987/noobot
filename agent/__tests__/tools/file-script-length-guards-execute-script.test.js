/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  test,
  assert,
  fs,
  os,
  path,
  createFileTool,
  executeToolCall,
  transferSemanticContent,
  LENGTH_THRESHOLDS,
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  createScriptTool,
  buildAgentContext,
  parseToolResult,
  buildAttachmentService,
} from "./helpers/file-script-length-guards-helper.js";

function buildHostScriptAgentContext(basePath, userId, overrides = {}) {
  const runtime =
    overrides?.runtime && typeof overrides.runtime === "object" ? overrides.runtime : {};
  return buildAgentContext(basePath, userId, {
    ...overrides,
    runtime: {
      ...runtime,
      systemRuntime: {
        ...(runtime.systemRuntime || {}),
        sessionDir:
          runtime.systemRuntime?.sessionDir ||
          path.join(basePath, "runtime", "session", runtime.systemRuntime?.sessionId || "s-1"),
        config: {
          ...(runtime.systemRuntime?.config || {}),
          safeConfirm: false,
        },
        isSuperUser: true,
      },
    },
  });
}

test("execute_script: ordinary users require sandbox isolation", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-authorization-"));
  assert.deepEqual(
    createScriptTool({
      agentContext: buildAgentContext(basePath, "regular-user"),
    }),
    [],
  );

  const sandboxTools = createScriptTool({
    agentContext: buildAgentContext(basePath, "regular-user", {
      runtime: {
        globalConfig: {
          security: { executionIsolation: { mode: "sandbox" } },
        },
      },
    }),
  });
  assert.equal(
    sandboxTools.some((item) => item?.name === "execute_script"),
    true,
  );
  assert.match(sandboxTools.find((item) => item?.name === "execute_script").description, /bash/);
});
import { run } from "../../src/tools/execution/script-tool/process-exec.js";
import { enqueueDockerContainerTask } from "../../src/tools/execution/script-tool/docker-queue.js";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";

const TEST_TRANSFER_IDENTITY = Object.freeze({
  transferId: "transfer:test:execute-script:output",
  messageId: "message:test-execute-script",
  sessionId: "session:test-execute-script",
  turnScopeId: "turn:test-execute-script",
  runId: "run:test-execute-script",
  producer: { type: "tool", id: "call:test-execute-script" },
});

function invokeScript(tool, args) {
  return tool.invoke(args, { configurable: { transferIdentity: TEST_TRANSFER_IDENTITY } });
}

test("execute_script: command 超过 semantic-transfer 阈值时保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("execute_script concrete tool must not be invoked for overlong input");
    },
  };

  const command = "a".repeat(LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars + 1);
  const runnerResult = await executeToolCall({
    call: { id: "call_long_script", name: "execute_script", args: { command } },
    tool,
    runtime: {
      basePath,
      systemRuntime: { userId: "u-test", sessionId: "s-script" },
      globalConfig: {},
      userConfig: {},
      attachmentService: buildAttachmentService(),
    },
    agentContext: buildAgentContext(basePath, "u-test"),
    sessionId: "s-script",
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(invoked, false);
  assert.equal(runnerResult.success, true);
  assert.equal(result.toolName, "execute_script");
  assert.equal(result.ok, false);
  assert.equal(result.message, "脚本内容过长，请分批执行或拆分脚本/文本后重试");
  assert.equal(Array.isArray(result.transferEnvelopes), true);
  assert.equal(result.transferEnvelopes.length, 1);
  assert.equal(result.transferEnvelopes[0].version, 2);
  assert.equal(result.transferEnvelopes[0].payload.mode, "attachment");
  assert.equal(
    result.transferEnvelopes[0].payload.attachments[0].name,
    "execute-script-command.tool-input.sh",
  );
  assert.equal(
    typeof result.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "string",
  );
  assert.equal(result.toolInputOverflow?.field, "command");
});

test("execute_script: host 执行以 workspace 根作为统一相对路径基准", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-path-view-"));
  const tools = createScriptTool({
    agentContext: buildHostScriptAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              execution: { view: "host" },
            },
          },
        },
        sharedTools: {},
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);
  assert.match(tool.description, /\/bin\/sh/);

  const result = parseToolResult(
    await invokeScript(tool, { command: "printf 'ok'", riskLevel: "low" }),
  );

  assert.equal(result.toolName, "execute_script");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "local");
  assert.deepEqual(result.workspace, { path: ".", view: "workspace" });
  assert.deepEqual(result.execution, { view: "service_host_restricted", provider: "host" });
  assert.equal(result.runtime, undefined);
  assert.equal(result.mounts, undefined);
  assert.equal(result.stdout, "ok");
});

test("execute_script: 可选给 stdout/stderr 加行号", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-lines-"));
  const tools = createScriptTool({
    agentContext: buildHostScriptAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const defaultResult = parseToolResult(
    await invokeScript(tool, { command: "printf 'a\\nb\\n'", riskLevel: "low" }),
  );
  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.includeLineNumbers, false);
  assert.equal(defaultResult.stdout, "a\nb\n");

  const withLines = parseToolResult(
    await invokeScript(tool, {
      command: "printf 'a\\nb\\n'; printf 'err\\n' >&2",
      riskLevel: "low",
      includeLineNumbers: true,
    }),
  );
  assert.equal(withLines.ok, true);
  assert.equal(withLines.includeLineNumbers, true);
  assert.equal(withLines.stdout, "1 | a\n2 | b");
  assert.equal(withLines.stderr, "1 | err");
});

test("execute_script: foreground 模式保留 shell 管道、stderr 与非零退出码语义", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-spawn-semantics-"));
  const tools = createScriptTool({
    agentContext: buildHostScriptAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const shellResult = parseToolResult(
    await invokeScript(tool, { command: "printf 'alpha\\nbeta\\n' | grep beta", riskLevel: "low" }),
  );
  assert.equal(shellResult.ok, true);
  assert.equal(shellResult.stdout, "beta\n");
  assert.equal(shellResult.stderr, "");

  const failResult = parseToolResult(
    await invokeScript(tool, {
      command:
        "node -e \"console.error('boom'); process.stdout.write('partial'); process.exit(7)\"",
      riskLevel: "low",
    }),
  );
  assert.equal(failResult.ok, false);
  assert.equal(failResult.code, 7);
  assert.equal(failResult.stdout, "partial");
  assert.equal(failResult.stderr.trim(), "boom");
});

test("execute_script: foreground 大输出通过 V2 附件身份保留", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-large-output-"));
  const tools = createScriptTool({
    agentContext: buildHostScriptAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
        attachmentService: buildAttachmentService(),
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const outputLength = 1024 * 1024 + 12345;
  const result = parseToolResult(
    await invokeScript(tool, {
      command: `node -e "process.stdout.write('x'.repeat(${outputLength}))"`,
      riskLevel: "low",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.outputOverflow, true);
  assert.equal(result.stdout.length, LENGTH_THRESHOLDS.semanticTransfer.previewChars);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("xxx"), true);
  const stdoutRef = result.transferEnvelopes[0].payload.attachments.find(
    (item) => item.name === "execute-script-stdout.txt",
  );
  assert.equal(stdoutRef.size, outputLength);
  assert.equal(typeof stdoutRef.identity.attachmentId, "string");
  assert.equal(result.stdoutPath, undefined);
});

test("execute_script: background 模式将 stdout/stderr 交给附件层并返回 V2 身份", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-background-mode-"));
  const savedArtifacts = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map(
        (artifact = {}, index) => {
          const content = Buffer.from(String(artifact.contentBase64 || ""), "base64").toString(
            "utf8",
          );
          savedArtifacts.push({ ...artifact, content, generationSource: payload.generationSource });
          return {
            attachmentId: `att-script-background-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: Buffer.byteLength(content, "utf8"),
            path: `/host/background/${artifact.name}`,
            relativePath: `runtime/attach/background/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          };
        },
      );
    },
  };
  const agentContext = buildHostScriptAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: { security: { executionIsolation: { mode: "host" } } },
      attachmentService,
    },
  });
  const tool = createScriptTool({ agentContext }).find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const result = parseToolResult(
    await invokeScript(tool, {
      command: "printf 'out'; printf 'err' >&2",
      riskLevel: "low",
      executionMode: "background",
    }),
  );
  const stdoutArtifact = savedArtifacts.find((item) => item.name === "execute-script-stdout.txt");
  const stderrArtifact = savedArtifacts.find((item) => item.name === "execute-script-stderr.txt");

  assert.equal(result.ok, true);
  assert.equal(result.executionMode, "background");
  assert.equal(result.stdout, undefined);
  assert.equal(result.stderr, undefined);
  assert.equal(result.transferEnvelopes.length, 1);
  assert.equal(result.transferEnvelopes[0].version, 2);
  assert.equal(result.transferEnvelopes[0].payload.mode, "attachment");
  assert.equal(stdoutArtifact?.content, "out");
  assert.equal(stderrArtifact?.content, "err");
  assert.equal(stdoutArtifact?.generationSource, "execute_script_background");
  assert.equal(result.transferEnvelopes[0].payload.attachments.length, 2);
  assert.equal(
    result.transferEnvelopes[0].payload.attachments.every((item) => item.identity.attachmentId),
    true,
  );
});

test("execute_script: 大 stdout 通过 foreground 原文件 semantic-transfer 保留完整内容", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-large-transfer-"));
  const outputLength = 1024 * 1024 + 12345;
  const savedArtifacts = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map(
        (artifact = {}, index) => {
          const content = Buffer.from(String(artifact.contentBase64 || ""), "base64").toString(
            "utf8",
          );
          savedArtifacts.push({ ...artifact, content });
          return {
            attachmentId: `att-script-output-${index + 1}`,
            sessionId: payload.sessionId,
            attachmentSource: payload.attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: Buffer.byteLength(content, "utf8"),
            path: `/host/${artifact.name}`,
            relativePath: `runtime/attach/${artifact.name}`,
            generatedByModel: true,
            generationSource: payload.generationSource,
          };
        },
      );
    },
  };
  const agentContext = buildHostScriptAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: { security: { executionIsolation: { mode: "host" } } },
      attachmentService,
    },
  });
  const tool = createScriptTool({ agentContext }).find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_large_script_output",
      name: "execute_script",
      args: {
        command: `node -e "process.stdout.write('x'.repeat(${outputLength}))"`,
        riskLevel: "low",
      },
    },
    tool,
    runtime: {
      basePath,
      systemRuntime: { userId: "primary-user", sessionId: "s-script-large-output" },
      globalConfig: { security: { executionIsolation: { mode: "host" } } },
      userConfig: {},
      attachmentService,
    },
    agentContext,
    sessionId: "s-script-large-output",
  });
  const result = parseToolResult(runnerResult.toolResultText);
  const stdoutFile = runnerResult.transferEnvelopes[0].payload.attachments.find(
    (item) => item.name === "execute-script-stdout.txt",
  );

  assert.equal(result.ok, true);
  assert.equal(result.outputOverflow, true);
  assert.equal(result.overflowed, undefined);
  assert.deepEqual(result.attachmentRefs, [
    "attachment:v1:s-script-large-output/model/att-script-output-1",
  ]);
  assert.equal(result.transferEnvelopes, undefined);
  assert.equal(savedArtifacts.length, 1);
  assert.equal(savedArtifacts[0].content.length, outputLength);
  assert.equal(stdoutFile.size, outputLength);
  assert.equal(typeof stdoutFile.identity.attachmentId, "string");
});

test("execute_script: foreground timeout terminates the process group and settles", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-timeout-group-"));
  const startedAt = Date.now();
  const result = await run("sh -c 'trap \"\" TERM; while :; do sleep 1; done'", cwd, 50, null, {
    generatedDataRoot: cwd,
  });

  assert.equal(result.code, 124);
  assert.ok(Date.now() - startedAt < 4000);
  assert.match(result.stderr, /timed out after 50ms/);
});

test("execute_script: foreground abort terminates the process group and settles", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX process-group semantics");
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-abort-group-"));
  const controller = new AbortController();
  const startedAt = Date.now();
  let terminationHookCalls = 0;
  const pending = run(
    "sh -c 'trap \"\" TERM; while :; do sleep 1; done'",
    cwd,
    60000,
    controller.signal,
    {
      generatedDataRoot: cwd,
      onTerminate: () => {
        terminationHookCalls += 1;
      },
    },
  );
  setTimeout(() => controller.abort(), 50);
  const result = await pending;

  assert.equal(result.code, 130);
  assert.equal(terminationHookCalls, 1);
  assert.ok(Date.now() - startedAt < 4000);
  assert.match(result.stderr, /command aborted/);
});

test("execute_script: aborted Docker queue entry never starts after lock release", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const containerName = `script-queue-abort-${Date.now()}`;
  const first = enqueueDockerContainerTask({
    containerName,
    task: async () => firstGate,
  });
  const controller = new AbortController();
  let secondInvoked = false;
  const second = enqueueDockerContainerTask({
    containerName,
    abortSignal: controller.signal,
    task: async () => {
      secondInvoked = true;
    },
  });

  controller.abort();
  releaseFirst();
  await first;
  await assert.rejects(second, (error) => error?.name === "AbortError");
  assert.equal(secondInvoked, false);
});

test("execute_script: sandbox 返回统一 workspace 根执行路径", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-sandbox-view-"));
  const meta = buildExecutionWorkspaceMeta({
    executionPolicy: resolveToolExecutionPolicy({
      toolName: "execute_script",
      globalConfig: { security: { executionIsolation: { mode: "sandbox" } } },
    }),
    workspace: basePath,
    runtime: { userId: "primary-user" },
    pathContext: { currentDirectory: "/workspace/primary-user" },
  });

  assert.deepEqual(meta, { path: ".", view: "workspace" });
});

test("execute_script: Docker 返回仅保留镜像名和当前 workspace 视角", async () => {
  const meta = buildScriptExecutionMeta({
    executionPolicy: resolveToolExecutionPolicy({
      toolName: "execute_script",
      globalConfig: { security: { executionIsolation: { mode: "sandbox" } } },
    }),
    workspace: "/host/primary-user",
    docker: {
      image: "example/script:latest",
      containerName: "noobot-script-sandbox",
      scope: "global",
      workdir: "/workspace/primary-user",
      mounts: [{ source: "/host/project", target: "/project" }],
    },
  });

  assert.equal(meta.execution.image, "nikolaik/python-nodejs:python3.12-nodejs26-bookworm");
  assert.equal(meta.execution.view, "workspace_sandbox");
  assert.equal(meta.execution.provider, "docker");
  assert.equal(meta.mounts, undefined);
  assert.deepEqual(meta.workspace, { path: ".", view: "workspace" });
});
