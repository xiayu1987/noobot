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

test("read_file: reads own workspace through the logical workspace view", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const filePath = path.join(basePath, "runtime/ops_workdir/result.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{"ok":true}', "utf8");

  const agentContext = buildAgentContext(basePath, "primary-user");
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_read_workspace_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: "runtime/ops_workdir/result.json" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, '1 | {"ok":true}');
  assert.equal(result.includeLineNumbers, true);
  assert.equal(result.resolvedPath, filePath);
  assert.equal(result.pathView, "workspace");
  assert.equal(result.executionView, "service_host");
  assert.equal(String(result.resolvedPath || "").includes(workspaceRoot), true);
});

test("read_file: regular user cannot read another user workspace through /workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "u-test");
  const otherUserFile = path.join(workspaceRoot, "other-user", "secret.txt");
  await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
  await fs.writeFile(otherUserFile, "secret", "utf8");

  const agentContext = buildAgentContext(basePath, "u-test", {
    runtime: {
      globalConfig: {
        workspaceRoot,
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "global" },
          },
        },
      },
    },
  });
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_regular_user_read_other_workspace",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/workspace/other-user/secret.txt" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /scope|范围|允许|path/i);
});

test("read_file: configured super user id does not bypass isolation when runtime flag is missing", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const superUserId = "super-root-user";
  const basePath = path.join(workspaceRoot, superUserId);
  const otherUserFile = path.join(workspaceRoot, "other-user", "secret.txt");
  await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
  await fs.writeFile(otherUserFile, "secret", "utf8");

  const agentContext = buildAgentContext(basePath, superUserId, {
    runtime: {
      globalConfig: { workspaceRoot, super_admin: { user_id: superUserId } },
      systemRuntime: { userId: superUserId, sessionId: "s-1", rootSessionId: "s-1", config: {} },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  const runnerResult = await executeToolCall({
    call: {
      id: "call_missing_super_flag",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/workspace/other-user/secret.txt" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /scope|范围|允许|path/i);
});

test("read_file: non-true super user runtime flag does not bypass isolation", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const superUserId = "super-root-user";
  const basePath = path.join(workspaceRoot, superUserId);
  const otherUserFile = path.join(workspaceRoot, "other-user", "secret.txt");
  await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
  await fs.writeFile(otherUserFile, "secret", "utf8");

  const agentContext = buildAgentContext(basePath, superUserId, {
    runtime: {
      globalConfig: { workspaceRoot, super_admin: { user_id: superUserId } },
      systemRuntime: {
        userId: superUserId,
        sessionId: "s-1",
        rootSessionId: "s-1",
        isSuperUser: "true",
        config: {},
      },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  const runnerResult = await executeToolCall({
    call: {
      id: "call_non_true_super_flag",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/workspace/other-user/secret.txt" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /scope|范围|允许|path/i);
});

test("read_file: configured super user can read another user workspace through host view", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const otherUserFile = path.join(workspaceRoot, "other-user", "visible.txt");
  await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
  await fs.writeFile(otherUserFile, "visible", "utf8");

  const agentContext = buildAgentContext(basePath, "super-root-user", {
    runtime: {
      systemRuntime: {
        userId: "super-root-user",
        sessionId: "s-1",
        rootSessionId: "s-1",
        isSuperUser: true,
        config: {},
      },
      globalConfig: {
        workspaceRoot,
        super_admin: { user_id: "super-root-user" },
        security: { executionIsolation: { mode: "host" } },
      },
    },
  });
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_read_other_workspace",
      name: "read_file",
      args: { riskLevel: "low", filePath: otherUserFile },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | visible");
  assert.equal(result.resolvedPath, otherUserFile);
});

test("read_file: sandboxed super user in docker user scope cannot read another user through /workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const otherUserFile = path.join(workspaceRoot, "other-user", "hidden.txt");
  await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(otherUserFile, "hidden", "utf8");

  const agentContext = buildAgentContext(basePath, "super-root-user", {
    runtime: {
      systemRuntime: {
        userId: "super-root-user",
        sessionId: "s-1",
        rootSessionId: "s-1",
        isSuperUser: true,
        config: {},
      },
      globalConfig: {
        workspaceRoot,
        super_admin: { user_id: "super-root-user" },
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_docker_user_scope_read_other_workspace",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/workspace/other-user/hidden.txt" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(
    String(result.message || result.error || ""),
    /not found|不存在|未找到|scope|范围|允许|path/i,
  );
});

test("read_file: regular user cannot read an absolute file outside allowed roots", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-outside-root-"));
  const basePath = path.join(workspaceRoot, "u-test");
  const outsideFile = path.join(outsideRoot, "secret.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "secret", "utf8");

  const agentContext = buildAgentContext(basePath, "u-test", {
    runtime: {
      globalConfig: { workspaceRoot },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_regular_user_read_outside_absolute_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: outsideFile },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /scope|范围|允许|path/i);
});

test("read_file: super user can read an absolute file outside workspace root", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "visible.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "visible-outside", "utf8");

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
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_read_outside_absolute_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: outsideFile },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | visible-outside");
  assert.equal(result.resolvedPath, outsideFile);
});

test("read_file: global sandbox forbids super user host paths without widening mounts", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-sandbox-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "hidden.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "hidden-outside", "utf8");

  const agentContext = buildAgentContext(basePath, "super-root-user", {
    runtime: {
      systemRuntime: {
        userId: "super-root-user",
        sessionId: "s-1",
        rootSessionId: "s-1",
        isSuperUser: true,
        config: {},
      },
      globalConfig: {
        workspaceRoot,
        super_admin: { user_id: "super-root-user" },
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: { provider: "docker", scope: "user" },
          },
        },
      },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_sandbox_read_outside_absolute_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: outsideFile },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /sandbox|scope|path|沙箱|范围/i);
});

test("read_file: configured super user cross-workspace read still respects mustExist", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
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
      globalConfig: {
        workspaceRoot,
        super_admin: { user_id: "super-root-user" },
        security: { executionIsolation: { mode: "host" } },
      },
    },
  });
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_super_user_read_missing_other_workspace",
      name: "read_file",
      args: { riskLevel: "low", filePath: path.join(workspaceRoot, "other-user", "missing.txt") },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /not found|不存在|未找到/i);
});

test("read_file: runtime sandbox mappings cannot grant file access", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const mountedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-mounted-root-"));
  const mountedFile = path.join(mountedRoot, "sandbox-mounted.txt");
  await fs.writeFile(mountedFile, "mounted-ok", "utf8");

  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: {
      systemRuntime: {
        userId: "primary-user",
        sessionId: "s-1",
        rootSessionId: "s-1",
        config: {
          sandboxPathMappings: [
            {
              source: mountedRoot,
              target: "/project",
            },
          ],
        },
      },
    },
  });
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_read_mounted_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/project/sandbox-mounted.txt" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /sandbox|沙箱|scope|范围/i);
});

test("read_file: execute_script docker mounts cannot grant file access", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-project-root-"));
  const projectFile = path.join(projectRoot, "agent/src/tools/execution/file-tool.js");
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  await fs.writeFile(projectFile, "project-mounted-ok", "utf8");

  const agentContext = buildAgentContext(basePath, "primary-user", {
    runtime: {
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "global",
              mounts: [{ source: projectRoot, target: "/project" }],
            },
          },
        },
      },
    },
  });
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_read_project_mount_path",
      name: "read_file",
      args: { riskLevel: "low", filePath: "/project/agent/src/tools/execution/file-tool.js" },
    },
    tool,
    runtime: agentContext.bindings.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.match(String(result.message || result.error || ""), /sandbox|沙箱|scope|范围/i);
});

test("file tools reject direct and nested symbolic-link escapes", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-symlink-workspace-"));
  const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-symlink-outside-"));
  await fs.writeFile(path.join(outsidePath, "secret.txt"), "secret", "utf8");
  await fs.symlink(path.join(outsidePath, "secret.txt"), path.join(workspacePath, "direct.txt"));
  await fs.mkdir(path.join(workspacePath, "nested"), { recursive: true });
  await fs.symlink(outsidePath, path.join(workspacePath, "nested", "escape"));
  const context = buildAgentContext(workspacePath, "u-test");
  const readTool = createFileTool({ agentContext: context }).find(
    (item) => item?.name === "read_file",
  );

  await assert.rejects(
    () => readTool.invoke({ filePath: "direct.txt", riskLevel: "low" }),
    /scope|范围|允许|path/i,
  );
  await assert.rejects(
    () => readTool.invoke({ filePath: "nested/escape/secret.txt", riskLevel: "low" }),
    /scope|范围|允许|path/i,
  );
});

test("write_file rejects a symbolic-link parent escape", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-symlink-workspace-"));
  const outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-symlink-outside-"));
  await fs.symlink(outsidePath, path.join(workspacePath, "escape"));
  const context = buildAgentContext(workspacePath, "u-test", {
    runtime: { systemRuntime: { config: { safeConfirm: false } } },
  });
  const writeTool = createFileTool({ agentContext: context }).find(
    (item) => item?.name === "write_file",
  );

  await assert.rejects(
    () =>
      writeTool.invoke({ filePath: "escape/created.txt", content: "blocked", riskLevel: "low" }),
    /scope|范围|允许|path/i,
  );
  await assert.rejects(() => fs.access(path.join(outsidePath, "created.txt")));
});

test("read_file: 默认返回行号且可关闭行号", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-lines-"));
  await fs.writeFile(path.join(basePath, "lines.txt"), "a\nb\nc\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const withLines = parseToolResult(
    await tool.invoke({ riskLevel: "low", filePath: "lines.txt", startLine: 2, endLine: 3 }),
  );
  assert.equal(withLines.ok, true);
  assert.equal(withLines.content, "2 | b\n3 | c");
  assert.equal(withLines.includeLineNumbers, true);

  const withoutLines = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      filePath: "lines.txt",
      startLine: 2,
      endLine: 3,
      includeLineNumbers: false,
    }),
  );
  assert.equal(withoutLines.ok, true);
  assert.equal(withoutLines.content, "b\nc");
  assert.equal(withoutLines.includeLineNumbers, false);
});

test("read_file: 默认读取行数阈值为 1000", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-default-lines-"));
  const content = Array.from({ length: 1001 }, (_, index) => `line-${index + 1}`).join("\n");
  await fs.writeFile(path.join(basePath, "long.txt"), content, "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", filePath: "long.txt", includeLineNumbers: false }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 1000);
  assert.equal(result.totalLines, 1001);
  assert.equal(result.truncated, true);
  assert.equal(result.content.split("\n").length, 1000);
  assert.equal(result.content.endsWith("line-1000"), true);
});
