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
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].name, "execute-script-command.tool-input.sh");
  assert.equal(typeof result.transferFiles[0].transferFilePath, "string");
  assert.equal(result.toolInputOverflow?.field, "command");
});

test("execute_script: 非沙箱返回仅包含当前 host 工作目录视角", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-path-view-"));
  const runtimeOpsWorkdir = path.join(basePath, "runtime/ops_workdir");
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: false,
            },
          },
        },
        sharedTools: {
          resolveSandboxPath(payload = {}) {
            const hostPath = String(payload?.hostPath || payload?.path || "").trim();
            if (hostPath === runtimeOpsWorkdir) {
              return "/workspace/primary-user/runtime/ops_workdir";
            }
            return "";
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const result = parseToolResult(await tool.invoke({ command: "printf 'ok'", riskLevel: "low" }));

  assert.equal(result.toolName, "execute_script");
  assert.equal(result.ok, true);
  assert.equal(result.mode, "local");
  assert.deepEqual(result.workspace, {
    relativePath: "runtime/ops_workdir",
    absolutePath: runtimeOpsWorkdir,
    view: "non_sandbox",
  });
  assert.equal(result.runtime, undefined);
  assert.equal(result.mounts, undefined);
  assert.equal(result.stdout, "ok");
});

test("execute_script: 可选给 stdout/stderr 加行号", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-lines-"));
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: false,
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const defaultResult = parseToolResult(
    await tool.invoke({ command: "printf 'a\\nb\\n'", riskLevel: "low" }),
  );
  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.includeLineNumbers, false);
  assert.equal(defaultResult.stdout, "a\nb\n");

  const withLines = parseToolResult(
    await tool.invoke({ command: "printf 'a\\nb\\n'; printf 'err\\n' >&2", riskLevel: "low", includeLineNumbers: true }),
  );
  assert.equal(withLines.ok, true);
  assert.equal(withLines.includeLineNumbers, true);
  assert.equal(withLines.stdout, "1 | a\n2 | b");
  assert.equal(withLines.stderr, "1 | err");
});

test("execute_script: foreground 模式保留 shell 管道、stderr 与非零退出码语义", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-spawn-semantics-"));
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: false,
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const shellResult = parseToolResult(
    await tool.invoke({ command: "printf 'alpha\\nbeta\\n' | grep beta", riskLevel: "low" }),
  );
  assert.equal(shellResult.ok, true);
  assert.equal(shellResult.stdout, "beta\n");
  assert.equal(shellResult.stderr, "");

  const failResult = parseToolResult(
    await tool.invoke({
      command: "node -e \"console.error('boom'); process.stdout.write('partial'); process.exit(7)\"",
      riskLevel: "low",
    }),
  );
  assert.equal(failResult.ok, false);
  assert.equal(failResult.code, 7);
  assert.equal(failResult.stdout, "partial");
  assert.equal(failResult.stderr.trim(), "boom");
});

test("execute_script: foreground stdout 超过 Node exec 默认 1MiB 时不应被 maxBuffer 截断", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-large-output-"));
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: false,
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const outputLength = 1024 * 1024 + 12345;
  const result = parseToolResult(
    await tool.invoke({
      command: `node -e "process.stdout.write('x'.repeat(${outputLength}))"`,
      riskLevel: "low",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.stdout.length, outputLength);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.endsWith("xxx"), true);
});

test("execute_script: background 模式将 stdout/stderr 交给附件层并返回路径", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-background-mode-"));
  const savedArtifacts = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map((artifact = {}, index) => {
        const content = Buffer.from(String(artifact.contentBase64 || ""), "base64").toString("utf8");
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
      });
    },
  };
  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: false,
          },
        },
      },
      attachmentService,
    },
  });
  const tool = createScriptTool({ agentContext }).find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const result = parseToolResult(
    await tool.invoke({
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
  assert.equal(result.transferEnvelopes, undefined);
  assert.equal(result.outputFiles.stdout.bytes, 3);
  assert.equal(result.outputFiles.stderr.bytes, 3);
  assert.equal(await fs.readFile(result.outputFiles.stdout.filePath, "utf8"), "out");
  assert.equal(await fs.readFile(result.outputFiles.stderr.filePath, "utf8"), "err");
  assert.equal(stdoutArtifact?.content, "out");
  assert.equal(stderrArtifact?.content, "err");
  assert.equal(stdoutArtifact?.generationSource, "execute_script_background");
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[0].path.startsWith("/host/background/"), true);
});

test("execute_script: 大 stdout 经过 foreground semantic-transfer 保存时保留完整内容", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-large-transfer-"));
  const outputLength = 1024 * 1024 + 12345;
  const savedArtifacts = [];
  const attachmentService = {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map((artifact = {}, index) => {
        const content = Buffer.from(String(artifact.contentBase64 || ""), "base64").toString("utf8");
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
      });
    },
  };
  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: false,
          },
        },
      },
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
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: false,
          },
        },
      },
      userConfig: {},
      attachmentService,
    },
    agentContext,
    sessionId: "s-script-large-output",
  });
  const result = parseToolResult(runnerResult.toolResultText);
  const stdoutArtifact = savedArtifacts.find((item) => item.name.includes("stdout.txt"));

  assert.equal(result.ok, true);
  assert.equal(result.overflowed, true);
  assert.ok(stdoutArtifact);
  assert.equal(stdoutArtifact.content.length, outputLength);
  assert.equal(stdoutArtifact.content.endsWith("xxx"), true);
});

test("execute_script: 沙箱 workspace 元信息仅包含沙箱视角与 system 环境字段", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-sandbox-view-"));
  const runtimeOpsWorkdir = path.join(basePath, "runtime/ops_workdir");
  const meta = buildExecutionWorkspaceMeta({
    sandboxEnabled: true,
    sandboxProvider: "docker",
    workspace: runtimeOpsWorkdir,
    runtime: {
      userId: "primary-user",
      sharedTools: {
        resolveSandboxPath(payload = {}) {
          const hostPath = String(payload?.hostPath || payload?.path || "").trim();
          if (hostPath === runtimeOpsWorkdir) return "/workspace/primary-user/runtime/ops_workdir";
          return "";
        },
      },
    },
    dockerConfig: {
      dockerMounts: [{ source: "/host/project", target: "/project" }],
    },
  });

  assert.deepEqual(meta, {
    relativePath: "runtime/ops_workdir",
    absolutePath: "/workspace/primary-user/runtime/ops_workdir",
    view: "sandbox",
    defaultWorkdir: "/workspace/primary-user/runtime/ops_workdir",
    sandboxRoot: "/workspace",
    relativePathBase: "defaultWorkdir",
    allowedRoots: ["/workspace", "/project"],
    extraMountTargets: ["/project"],
  });
});

test("execute_script: Docker 返回仅保留镜像名和当前 workspace 视角", async () => {
  const meta = buildScriptExecutionMeta({
    sandboxEnabled: true,
    sandboxProvider: "docker",
    workspace: "/host/primary-user/runtime/ops_workdir",
    dockerConfig: {
      dockerMounts: [{ source: "/host/project", target: "/project" }],
    },
    docker: {
      image: "example/script:latest",
      containerName: "noobot-script-sandbox",
      scope: "global",
      workdir: "/workspace/primary-user/runtime/ops_workdir",
      dockerMounts: [{ source: "/host/project", target: "/project" }],
    },
  });

  assert.equal(meta.runtime.image, "example/script:latest");
  assert.equal(meta.runtime.container, undefined);
  assert.equal(meta.runtime.scope, undefined);
  assert.equal(meta.mounts, undefined);
  assert.equal(meta.workspace.absolutePath, "/workspace/primary-user/runtime/ops_workdir");
  assert.equal(meta.workspace.view, "sandbox");
  assert.deepEqual(meta.workspace.allowedRoots, ["/workspace", "/project"]);
});
