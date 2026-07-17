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

test("write_file: content 超过 semantic-transfer 阈值时保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("write_file concrete tool must not be invoked for overlong input");
    },
  };

  const filePath = "large.txt";
  const content = "x".repeat(LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars + 1);
  const runnerResult = await executeToolCall({
    call: { id: "call_long_write", name: "write_file", args: { filePath, content } },
    tool,
    runtime: {
      basePath,
      systemRuntime: { userId: "u-test", sessionId: "s-write" },
      globalConfig: {},
      userConfig: {},
      attachmentService: buildAttachmentService(),
    },
    agentContext: buildAgentContext(basePath, "u-test"),
    sessionId: "s-write",
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(invoked, false);
  assert.equal(runnerResult.success, true);
  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, false);
  assert.equal(result.message, "文件内容过长，请分批写入");
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].name, "large.txt.tool-input.txt");
  assert.equal(typeof result.transferFiles[0].transferFilePath, "string");
  assert.equal(result.toolInputOverflow?.field, "content");
  await assert.rejects(() => fs.access(path.join(basePath, filePath)));
});

test("write_file: 非沙箱返回 host 工作区路径视角", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-path-view-"));
  const tools = createFileTool({
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
  const tool = tools.find((item) => item?.name === "write_file");
  assert.ok(tool);

  const runtime = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: false,
          },
        },
      },
    },
  }).execution.controllers.runtime;
  const runnerResult = await executeToolCall({
    call: {
      id: "call_write_non_sandbox",
      name: "write_file",
      args: { riskLevel: "low", filePath: "runtime/ops_workdir/write-ok.txt", content: "ok" },
    },
    tool,
    runtime,
    agentContext: buildAgentContext(basePath, "primary-user", { runtime }),
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, path.join(basePath, "runtime/ops_workdir/write-ok.txt"));
});

test("write_file: 启用沙箱返回沙箱路径视角", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-sandbox-view-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: true,
              sandboxProvider: {
                default: "docker",
                docker: { dockerContainerScope: "global" },
              },
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "write_file");
  assert.ok(tool);

  const runtime = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        tools: {
          execute_script: {
            sandboxMode: true,
            sandboxProvider: {
              default: "docker",
              docker: { dockerContainerScope: "global" },
            },
          },
        },
      },
    },
  }).execution.controllers.runtime;
  const runnerResult = await executeToolCall({
    call: {
      id: "call_write_sandbox",
      name: "write_file",
      args: { riskLevel: "low", filePath: "runtime/ops_workdir/write-ok.txt", content: "ok" },
    },
    tool,
    runtime,
    agentContext: buildAgentContext(basePath, "primary-user", { runtime }),
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, "/workspace/primary-user/runtime/ops_workdir/write-ok.txt");
  assert.equal(String(result.resolvedPath || "").includes(workspaceRoot), false);
});

test("write_file: super user can write an absolute file outside workspace root", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "created", "write-ok.txt");
  await fs.mkdir(basePath, { recursive: true });

  const agentContext = buildAgentContext(basePath, "super-root-user", {
    runtime: {
      systemRuntime: { userId: "super-root-user", sessionId: "s-1", rootSessionId: "s-1", isSuperUser: true, config: {} },
      globalConfig: { workspaceRoot, super_admin: { user_id: "super-root-user" } },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "write_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_write_outside_absolute_path",
      name: "write_file",
      args: { riskLevel: "low", filePath: outsideFile, content: "write-outside" },
    },
    tool,
    runtime: agentContext.execution.controllers.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, outsideFile);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "write-outside");
});
