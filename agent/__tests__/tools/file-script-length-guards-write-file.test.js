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
  assert.equal(Array.isArray(result.transferEnvelopes), true);
  assert.equal(result.transferEnvelopes.length, 1);
  assert.equal(result.transferEnvelopes[0].version, 2);
  assert.equal(result.transferEnvelopes[0].payload.mode, "attachment");
  assert.equal(result.transferEnvelopes[0].payload.attachments[0].name, "large.txt.tool-input.txt");
  assert.equal(
    typeof result.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "string",
  );
  assert.equal(result.toolInputOverflow?.field, "content");
  await assert.rejects(() => fs.access(path.join(basePath, filePath)));
});

test("write_file: host 模式返回宿主正常路径并在 host 执行", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-path-view-"));
  const attachmentService = buildAttachmentService();
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        attachmentService,
        globalConfig: {
          tools: {
            execute_script: {
              execution: { view: "host" },
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
      attachmentService,
      globalConfig: {
        tools: {
          execute_script: {
            execution: { view: "host" },
          },
        },
      },
    },
  }).bindings.runtime;
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
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.resolvedPath, path.join(basePath, "runtime/ops_workdir/write-ok.txt"));
  assert.equal(result.pathView, "workspace");
  assert.equal(result.executionView, "service_host");
});

test("write_file: successful output is published as a canonical attachment", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-transfer-"));
  const attachmentService = buildAttachmentService();
  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: { attachmentService },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "write_file");
  const runnerResult = await executeToolCall({
    call: {
      id: "call_write_transfer",
      name: "write_file",
      args: { riskLevel: "low", filePath: "runtime/ops_workdir/result.md", content: "# result" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
    sessionId: "s-1",
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(runnerResult.success, true);
  assert.equal(runnerResult.transferEnvelopes?.length, 1);
  assert.equal(runnerResult.transferEnvelopes[0]?.version, 2);
  assert.equal(runnerResult.transferEnvelopes[0]?.payload?.attachments?.[0]?.name, "result.md");
  assert.equal("attachments" in result, false);
  assert.equal("outputArtifacts" in result, false);
  assert.equal(
    await fs.readFile(path.join(basePath, "runtime/ops_workdir/result.md"), "utf8"),
    "# result",
  );
});

test("write_file: sandbox 模式使用宿主受控 I/O 并返回 sandbox 展示路径", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-sandbox-view-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  await fs.mkdir(basePath, { recursive: true });
  const attachmentService = buildAttachmentService();
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: {
        attachmentService,
        globalConfig: {
          workspaceRoot,
          security: {
            executionIsolation: {
              mode: "sandbox",
              sandbox: { provider: "docker", scope: "user", image: "missing-node-runtime" },
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
      attachmentService,
      globalConfig: {
        workspaceRoot,
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user", image: "missing-node-runtime" },
          },
        },
      },
    },
  }).bindings.runtime;
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
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.resolvedPath, "/workspace/runtime/ops_workdir/write-ok.txt");
  assert.equal(result.pathView, "workspace");
  assert.equal(result.executionView, "service_host");
  assert.equal(String(result.resolvedPath || "").includes(workspaceRoot), false);
});

test("workspace I/O: file tools keep one sandbox display path end to end", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-file-sandbox-e2e-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  await fs.mkdir(basePath, { recursive: true });
  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        workspaceRoot,
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "user",
              containerName: "noobot-file-tools-integration",
            },
          },
        },
      },
    },
  });
  const tools = new Map(createFileTool({ agentContext }).map((tool) => [tool.name, tool]));
  const filePath = "/workspace/runtime/ops_workdir/sandbox-flow.txt";

  const written = parseToolResult(
    await tools.get("write_file").invoke({
      filePath,
      content: "alpha\nbeta\n",
      riskLevel: "low",
    }),
  );
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.resolvedPath, filePath);
  assert.equal(written.executionView, "service_host");

  const firstRead = parseToolResult(
    await tools.get("read_file").invoke({
      filePath,
      includeLineNumbers: false,
      riskLevel: "low",
    }),
  );
  assert.equal(firstRead.content, "alpha\nbeta");
  assert.equal(firstRead.executionView, "service_host");

  const searched = parseToolResult(
    await tools.get("search").invoke({
      source: "files",
      path: "/workspace/runtime/ops_workdir",
      query: "beta",
      glob: "**/*.txt",
      riskLevel: "low",
    }),
  );
  assert.equal(searched.ok, true, JSON.stringify(searched));
  assert.equal(searched.matches.length, 1);
  assert.equal(searched.matches[0].filePath, filePath);

  const patched = parseToolResult(
    await tools.get("patch_file").invoke({
      format: "apply_patch",
      patch: [
        "*** Begin Patch",
        "*** Update File: runtime/ops_workdir/sandbox-flow.txt",
        "@@",
        " alpha",
        "-beta",
        "+gamma",
        "*** End Patch",
        "",
      ].join("\n"),
      riskLevel: "low",
    }),
  );
  assert.equal(patched.ok, true, JSON.stringify(patched));
  assert.deepEqual(patched.changedFiles, [filePath]);

  const finalRead = parseToolResult(
    await tools.get("read_file").invoke({
      filePath,
      includeLineNumbers: false,
      riskLevel: "low",
    }),
  );
  assert.equal(finalRead.content, "alpha\ngamma");
  assert.equal(
    await fs.readFile(path.join(basePath, "runtime/ops_workdir/sandbox-flow.txt"), "utf8"),
    "alpha\ngamma\n",
  );
});

test("write_file: super user can write an absolute file outside workspace root", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "created", "write-ok.txt");
  await fs.mkdir(basePath, { recursive: true });

  const agentContext = buildAgentContext(basePath, "super-root-user", {
    runtime: {
      systemRuntime: {
        userId: "super-root-user",
        sessionId: "s-1",
        rootSessionId: "s-1",
        isSuperUser: true,
        config: {},
      },
      globalConfig: { workspaceRoot, super_admin: { user_id: "super-root-user" } },
      userInteractionBridge: {
        async requestUserInteraction() {
          return { confirmed: true };
        },
      },
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
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, outsideFile);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "write-outside");
});
