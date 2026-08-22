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

test("write_file: overwrite=false uses the canonical failed result protocol", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-existing-"));
  await fs.writeFile(path.join(basePath, "existing.txt"), "original", "utf8");
  const agentContext = buildAgentContext(basePath, "u-test");
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "write_file");

  const result = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      filePath: "existing.txt",
      content: "replacement",
      overwrite: false,
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "RECOVERABLE_FILE_ALREADY_EXISTS");
  assert.equal(result.error, "文件已存在；如需替换，请将 overwrite 设置为 true。");
  assert.equal(await fs.readFile(path.join(basePath, "existing.txt"), "utf8"), "original");
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
  assert.deepEqual(result.path, { view: "workspace", path: "runtime/ops_workdir/write-ok.txt" });
  assert.equal("resolvedPath" in result, false);
});

test("write_file: successful output uses the canonical mutation result", async () => {
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
  assert.equal(runnerResult.transferEnvelopes?.length || 0, 0);
  assert.equal(result.protocol, "noobot.file-mutation-result");
  assert.ok(result.mutation?.id);
  assert.equal(result.mutation.path, "runtime/ops_workdir/result.md");
  assert.equal(result.mutation.after.size, 8);
  assert.equal("outputArtifacts" in result, false);
  assert.equal(
    await fs.readFile(path.join(basePath, "runtime/ops_workdir/result.md"), "utf8"),
    "# result",
  );
});

test("file tools retain one internal ResourceRef for repeated logical path inputs", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-file-resource-input-"));
  const agentContext = buildAgentContext(basePath, "primary-user");
  const tools = createFileTool({ agentContext });
  const writeTool = tools.find((item) => item?.name === "write_file");
  const readTool = tools.find((item) => item?.name === "read_file");
  const written = parseToolResult(
    await writeTool.invoke({
      riskLevel: "low",
      filePath: "reports/resource.txt",
      content: "resource-round-trip",
    }),
  );

  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.resources.length, 1);
  const read = parseToolResult(
    await readTool.invoke({ riskLevel: "low", filePath: written.path.path }),
  );
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.content, "1 | resource-round-trip");
  assert.equal(read.resources[0].resourceId, written.resources[0].resourceId);
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
  assert.deepEqual(result.path, { view: "workspace", path: "runtime/ops_workdir/write-ok.txt" });
  assert.equal("resolvedPath" in result, false);
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
  assert.deepEqual(written.path, {
    view: "workspace",
    path: "runtime/ops_workdir/sandbox-flow.txt",
  });

  const firstRead = parseToolResult(
    await tools.get("read_file").invoke({
      filePath,
      includeLineNumbers: false,
      riskLevel: "low",
    }),
  );
  assert.equal(firstRead.content, "alpha\nbeta");
  assert.deepEqual(firstRead.path, written.path);

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
  assert.deepEqual(searched.matches[0].path, written.path);

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
  assert.equal(patched.changes.length, 1);
  assert.deepEqual(patched.changes[0].path, written.path);
  assert.equal(patched.changes[0].action, "write");
  assert.ok(patched.changes[0].mutation?.id);
  assert.equal(patched.changes[0].mutation.path, written.path.path);
  assert.equal(patched.mutations.length, 1);
  assert.equal(patched.mutations[0].id, patched.changes[0].mutation.id);

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
  assert.deepEqual(result.path, { view: "host", path: outsideFile });
  assert.equal(await fs.readFile(outsideFile, "utf8"), "write-outside");
});

test("write_file: global sandbox mounts enforce their protocol readOnly flag", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-mount-workspace-"));
  const writableRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-mount-rw-"));
  const readOnlyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-mount-ro-"));
  const agentContext = buildAgentContext(basePath, "u-test", {
    runtime: {
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "user",
              mounts: [
                { source: writableRoot, target: "/shared-write" },
                { source: readOnlyRoot, target: "/shared-readonly", readOnly: true },
              ],
            },
          },
        },
      },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "write_file");

  const written = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      filePath: "/shared-write/result.txt",
      content: "mounted-write",
    }),
  );
  assert.equal(written.ok, true);
  assert.deepEqual(written.path, { view: "workspace", path: "/shared-write/result.txt" });
  assert.equal(await fs.readFile(path.join(writableRoot, "result.txt"), "utf8"), "mounted-write");

  await assert.rejects(
    () =>
      tool.invoke({
        riskLevel: "low",
        filePath: "/shared-readonly/result.txt",
        content: "blocked",
      }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.reason, "sandbox_mount_read_only");
      return true;
    },
  );
});
