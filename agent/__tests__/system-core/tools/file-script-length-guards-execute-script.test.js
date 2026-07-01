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

  const result = parseToolResult(await tool.invoke({ command: "printf 'ok'" }));

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
    await tool.invoke({ command: "printf 'a\\nb\\n'" }),
  );
  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.includeLineNumbers, false);
  assert.equal(defaultResult.stdout, "a\nb\n");

  const withLines = parseToolResult(
    await tool.invoke({ command: "printf 'a\\nb\\n'; printf 'err\\n' >&2", includeLineNumbers: true }),
  );
  assert.equal(withLines.ok, true);
  assert.equal(withLines.includeLineNumbers, true);
  assert.equal(withLines.stdout, "1 | a\n2 | b");
  assert.equal(withLines.stderr, "1 | err");
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
