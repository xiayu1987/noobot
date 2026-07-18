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
import { parseUnifiedDiff } from "../../../src/system-core/tools/execution/file-patch.js";

test("patch_file: schema path hints only describe the active path view", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-schema-workspace-root-"));
  const basePath = path.join(workspaceRoot, "u-test");
  await fs.mkdir(basePath, { recursive: true });

  const regularHostTool = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        globalConfig: { workspaceRoot },
      },
    }),
  }).find((item) => item?.name === "patch_file");
  const regularHostDescription = regularHostTool?.schema?.shape?.patch?.description || "";
  assert.match(regularHostDescription, /Host 视角/);
  assert.match(regularHostDescription, /rootDirectory/);
  assert.doesNotMatch(regularHostDescription, /allowedRoots/);
  assert.doesNotMatch(regularHostDescription, /sandbox|超级管理员|super user/i);

  const superHostTool = createFileTool({
    agentContext: buildAgentContext(basePath, "super-root-user", {
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
        },
      },
    }),
  }).find((item) => item?.name === "patch_file");
  const superHostDescription = superHostTool?.schema?.shape?.patch?.description || "";
  assert.match(superHostDescription, /Windows/);
  assert.match(superHostDescription, /macOS\/Linux/);
  assert.doesNotMatch(superHostDescription, /sandbox/i);

  const sandboxTool = createFileTool({
    agentContext: buildAgentContext(basePath, "super-root-user", {
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
  }).find((item) => item?.name === "patch_file");
  const sandboxDescription = sandboxTool?.schema?.shape?.patch?.description || "";
  assert.match(sandboxDescription, /rootDirectory/);
  assert.match(sandboxDescription, /allowedRoots/);
  assert.doesNotMatch(sandboxDescription, /host absolute|超级管理员|super user/i);
});

test("patch_file: 支持 apply_patch 和 unified_diff 协议", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\nthree\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const applyPatch = [
    "*** Begin Patch",
    "*** Update File: a.txt",
    "@@",
    " one",
    "-two",
    "+TWO",
    " three",
    "*** End Patch",
    "",
  ].join("\n");
  const applyResult = parseToolResult(await tool.invoke({ riskLevel: "low", format: "apply_patch", patch: applyPatch }));
  assert.equal(applyResult.ok, true);
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");

  const diff = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "-TWO",
    "+two",
    " three",
    "",
  ].join("\n");
  const dryRunResult = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1, dryRun: true }),
  );
  assert.equal(dryRunResult.ok, true);
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");

  const diffResult = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }));
  assert.equal(diffResult.ok, true);
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\ntwo\nthree\n");
});

test("patch_file: 默认使用主流 git diff/unified_diff 并兼容 git 元数据", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-git-diff-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src/a.txt"), "one\n--- literal\nthree\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const gitDiff = [
    "diff --git a/src/a.txt b/src/a.txt",
    "index 83db48f..bf269f4 100644",
    "--- a/src/a.txt",
    "+++ b/src/a.txt",
    "@@ -1,3 +1,3 @@",
    " one",
    "---- literal",
    "+--- changed literal",
    " three",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", patch: gitDiff }));
  assert.equal(result.ok, true);
  assert.equal(result.format, "unified_diff");
  assert.equal(await fs.readFile(path.join(basePath, "src/a.txt"), "utf8"), "one\n--- changed literal\nthree\n");
});

test("patch_file: unified_diff hunk 行数不准时自动按内容重算", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-counts-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\nthree\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const badCountDiff = [
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,9 +1,10 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: badCountDiff, strip: 1 }));
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");
});

test("patch_file: unified_diff 兼容 /project 虚拟路径前缀", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-path-"));
  await fs.mkdir(path.join(basePath, "client"), { recursive: true });
  await fs.writeFile(path.join(basePath, "client/a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a//project/client/a.txt",
    "+++ b//project/client/a.txt",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ["client/a.txt"]);
  assert.equal(await fs.readFile(path.join(basePath, "client/a.txt"), "utf8"), "one\nTWO\n");
});

test("patch_file: 超级管理员可将虚拟 project 路径解析到 workspace 下的项目根", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-super-root-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "package.json"), "{}", "utf8");
  await fs.writeFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "admin", {
      runtime: {
        systemRuntime: { isSuperUser: true, userId: "admin", sessionId: "s-1", rootSessionId: "s-1" },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/project/client/noobot-chat/src/a.txt",
    "+++ b/project/client/noobot-chat/src/a.txt",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ["noobot/client/noobot-chat/src/a.txt"]);
  assert.equal(await fs.readFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "utf8"), "one\nTWO\n");
});

test("patch_file: root 参数可将补丁路径解析到 workspace 子项目", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-root-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, "service/ws"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "service/ws/chat-websocket-server.js"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/service/ws/chat-websocket-server.js",
    "+++ b/service/ws/chat-websocket-server.js",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const dryRunResult = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1, root: "noobot", dryRun: true }),
  );
  assert.equal(dryRunResult.ok, true);
  assert.equal(dryRunResult.dryRun, true);
  assert.deepEqual(dryRunResult.changedFiles, ["noobot/service/ws/chat-websocket-server.js"]);
  assert.equal(dryRunResult.resolvedFiles[0]?.path, "noobot/service/ws/chat-websocket-server.js");
  assert.equal(
    await fs.readFile(path.join(repoPath, "service/ws/chat-websocket-server.js"), "utf8"),
    "one\ntwo\n",
  );

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1, root: "noobot" }),
  );
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(repoPath, "service/ws/chat-websocket-server.js"), "utf8"), "one\nTWO\n");
});

test("patch_file: root 参数兼容 Windows 风格反斜杠 diff 路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-root-win-"));
  const appPath = path.join(workspacePath, "app");
  await fs.mkdir(path.join(appPath, "service/ws"), { recursive: true });
  await fs.writeFile(path.join(appPath, "service/ws/chat-websocket-server.js"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a\\service\\ws\\chat-websocket-server.js",
    "+++ b\\service\\ws\\chat-websocket-server.js",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1, root: "app\\" }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ["app/service/ws/chat-websocket-server.js"]);
  assert.equal(await fs.readFile(path.join(appPath, "service/ws/chat-websocket-server.js"), "utf8"), "one\nTWO\n");
});

test("patch_file: 兼容模型混用 unified 文件头和 apply_patch 风格 @@ hunk", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-mixed-format-"));
  await fs.mkdir(path.join(basePath, "agent/src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "agent/src/a.js"), "import a from \"a\";\nimport b from \"b\";\nrun();\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const mixedPatch = [
    "--- a/agent/src/a.js",
    "+++ b/agent/src/a.js",
    "@@",
    " import a from \"a\";",
    "-import b from \"b\";",
    "+import c from \"c\";",
    " run();",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: mixedPatch }));
  assert.equal(result.ok, true);
  assert.equal(result.format, "unified_diff");
  assert.equal(await fs.readFile(path.join(basePath, "agent/src/a.js"), "utf8"), "import a from \"a\";\nimport c from \"c\";\nrun();\n");
});

test("patch_file: format 传错时自动回退到实际协议", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-format-fallback-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\nthree\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const applyPatch = [
    "*** Begin Patch",
    "*** Update File: a.txt",
    "@@",
    " one",
    "-two",
    "+TWO",
    " three",
    "*** End Patch",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: applyPatch }));
  assert.equal(result.ok, true);
  assert.equal(result.format, "apply_patch");
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");
});

test("patch_file: strip 传错时自动尝试无前缀路径", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-strip-fallback-"));
  await fs.mkdir(path.join(basePath, "agent/src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "agent/src/a.js"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- agent/src/a.js",
    "+++ agent/src/a.js",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }));
  assert.equal(result.ok, true);
  assert.equal(result.strip, 0);
  assert.equal(await fs.readFile(path.join(basePath, "agent/src/a.js"), "utf8"), "one\nTWO\n");
});

