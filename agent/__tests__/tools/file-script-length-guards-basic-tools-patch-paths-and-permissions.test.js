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
import { parseUnifiedDiff } from "../../src/tools/execution/file-patch.js";

test("patch_file: unified_diff 保留 Windows 绝对路径与 file URL 语义", () => {
  const driveDiff = [
    "--- C:\\work\\src\\a.txt",
    "+++ C:\\work\\src\\a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const drivePatch = parseUnifiedDiff(driveDiff, 1)[0];
  assert.equal(drivePatch.oldPath, "C:/work/src/a.txt");
  assert.equal(drivePatch.newPath, "C:/work/src/a.txt");

  const fileUrlDiff = [
    "--- file:///C:/work/src/a.txt",
    "+++ file:///C:/work/src/a.txt",
    "@@ -1,1 +1,1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const fileUrlPatch = parseUnifiedDiff(fileUrlDiff, 1)[0];
  assert.equal(fileUrlPatch.oldPath, "C:/work/src/a.txt");
  assert.equal(fileUrlPatch.newPath, "C:/work/src/a.txt");
});

test("patch_file: 普通用户不能修改 workspace 外绝对路径", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-outside-root-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const outsideFile = path.join(outsideRoot, "blocked.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "one\ntwo\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "primary-user", {
      runtime: { globalConfig: { workspaceRoot } },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    `--- ${outsideFile}`,
    `+++ ${outsideFile}`,
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff }),
    /路径超出允许范围|path out of scope/i,
  );
  assert.equal(await fs.readFile(outsideFile, "utf8"), "one\ntwo\n");
});

test("patch_file: super user can patch an absolute file outside workspace root", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-workspace-root-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "visible.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "one\ntwo\n", "utf8");
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
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    `--- ${outsideFile}`,
    `+++ ${outsideFile}`,
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.resolvedFiles[0]?.resolvedPath, outsideFile);
  assert.equal(await fs.readFile(outsideFile, "utf8"), "one\nTWO\n");
});

test("patch_file: sharedTools cannot remap a Windows host path", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-patch-win-workspace-root-"),
  );
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-win-outside-root-"));
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "visible.txt");
  const windowsFile = "C:\\outside\\visible.txt";
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "one\ntwo\n", "utf8");
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
      sharedTools: {
        resolveHostPath(payload = {}) {
          return String(payload.path || payload.sandboxPath || "").replaceAll("\\", "/") ===
            "C:/outside/visible.txt"
            ? outsideFile
            : "";
        },
      },
    },
  });
  agentContext.context.environment.os = { platform: "win32" };
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    `--- ${windowsFile}`,
    `+++ ${windowsFile}`,
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff }),
    /not found|scope|范围/i,
  );
  assert.equal(await fs.readFile(outsideFile, "utf8"), "one\ntwo\n");
});

test("patch_file: apply_patch also rejects sharedTools host remapping", async () => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-patch-apply-win-workspace-root-"),
  );
  const outsideRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-patch-apply-win-outside-root-"),
  );
  const basePath = path.join(workspaceRoot, "super-root-user");
  const outsideFile = path.join(outsideRoot, "visible.txt");
  const windowsFile = "C:\\outside\\visible.txt";
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsideFile, "one\ntwo\n", "utf8");
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
      sharedTools: {
        resolveHostPath(payload = {}) {
          return String(payload.path || payload.sandboxPath || "").replaceAll("\\", "/") ===
            "C:/outside/visible.txt"
            ? outsideFile
            : "";
        },
      },
    },
  });
  agentContext.context.environment.os = { platform: "win32" };
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    `*** Update File: ${windowsFile}`,
    "@@",
    " one",
    "-two",
    "+TWO",
    "*** End Patch",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "apply_patch", patch: patchText }),
    /not found|scope|范围/i,
  );
  assert.equal(await fs.readFile(outsideFile, "utf8"), "one\ntwo\n");
});

test("patch_file: 拒绝 root=.. 和 project 虚拟相对前缀", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-project-prefix-"));
  await fs.mkdir(path.join(basePath, "i18n/src/client/locales"), { recursive: true });
  const localeFile = path.join(basePath, "i18n/src/client/locales/zh-CN.js");
  await fs.writeFile(
    localeFile,
    'export default {\n  "hideChatNavigator": "隐藏对话导航"\n};\n',
    "utf8",
  );
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    "*** Update File: project/i18n/src/client/locales/zh-CN.js",
    "@@",
    " export default {",
    '-  "hideChatNavigator": "隐藏对话导航"',
    '+  "hideChatNavigator": "隐藏对话导航",',
    '+  "sessionStatus": "状态"',
    " };",
    "*** End Patch",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "apply_patch", patch: patchText, root: ".." }),
    /workspace-relative|工作区相对/i,
  );
});

test("patch_file: 拒绝 /project 沙箱绝对路径视角", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-project-sandbox-"));
  await fs.mkdir(path.join(basePath, "i18n/src/client/locales"), { recursive: true });
  const localeFile = path.join(basePath, "i18n/src/client/locales/en-US.js");
  await fs.writeFile(
    localeFile,
    'export default {\n  "hideChatNavigator": "Hide conversation navigation"\n};\n',
    "utf8",
  );
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        userId: "u-test",
        userConfig: {
          tools: {
            sandboxPathMappings: [{ source: basePath, target: "/project" }],
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    "*** Update File: /project/i18n/src/client/locales/en-US.js",
    "@@",
    " export default {",
    '-  "hideChatNavigator": "Hide conversation navigation"',
    '+  "hideChatNavigator": "Hide conversation navigation",',
    '+  "sessionStatus": "Status"',
    " };",
    "*** End Patch",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "apply_patch", patch: patchText }),
    /sandbox|沙箱/i,
  );
});

test("patch_file: execute_script 挂载不能授权 workspace 外项目", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-project-mount-"));
  const userWorkspacePath = path.join(rootPath, "workspace/admin");
  const projectPath = path.join(rootPath, "noobot");
  await fs.mkdir(path.join(projectPath, "client/noobot-chat/src/composables/chat"), {
    recursive: true,
  });
  await fs.mkdir(userWorkspacePath, { recursive: true });
  const targetFile = path.join(
    projectPath,
    "client/noobot-chat/src/composables/chat/useChatSession.js",
  );
  await fs.writeFile(targetFile, "function existing() {\n  return true;\n}\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(userWorkspacePath, "admin", {
      runtime: {
        userId: "admin",
        globalConfig: {
          workspaceRoot: path.join(rootPath, "workspace"),
          tools: {
            execute_script: {
              sandboxMode: true,
              sandboxProvider: {
                default: "docker",
                docker: {
                  dockerContainerScope: "global",
                  dockerMounts: [{ source: projectPath, target: "/project" }],
                },
              },
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const patchText = [
    "*** Begin Patch",
    "*** Update File: /project/client/noobot-chat/src/composables/chat/useChatSession.js",
    "@@",
    " function existing() {",
    "-  return true;",
    '+  return "sandbox-project";',
    " }",
    "*** End Patch",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "apply_patch", patch: patchText }),
    /sandbox|沙箱/i,
  );
  assert.equal(await fs.readFile(targetFile, "utf8"), "function existing() {\n  return true;\n}\n");
});

test("patch_file: root 参数拒绝沙箱路径并返回明确提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-root-sandbox-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src/a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/src/a.txt",
    "+++ b/src/a.txt",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, root: "/project" }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.field, "root");
      assert.match(error.details?.hint || "", /工作区相对|workspace-relative/i);
      return true;
    },
  );
});

test("patch_file: root 参数 host 错误提示不暗示沙箱路径", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-root-host-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: { sandboxMode: false },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = ["--- a/a.txt", "+++ b/a.txt", "@@ -1,2 +1,2 @@", " one", "-two", "+TWO", ""].join(
    "\n",
  );

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, root: "/project" }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.field, "root");
      assert.doesNotMatch(error.details?.hint || "", /\/project|\/workspace|沙箱|sandbox/i);
      return true;
    },
  );
});

test("patch_file: 路径不存在时诊断使用当前 workspace 执行审计路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-diagnostics-"));
  await fs.mkdir(path.join(workspacePath, "noobot/service/ws"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, "noobot/service/ws/chat-websocket-server.js"),
    "one\ntwo\n",
    "utf8",
  );
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

  await assert.rejects(
    async () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_FILE_NOT_FOUND");

      assert.equal(error.details?.basePath, workspacePath);
      assert.equal(error.details?.filePath, "service/ws/chat-websocket-server.js");
      assert.match(error.details?.hint || "", /root/);
      assert.equal(error.details?.attemptedPaths?.[0]?.path, "service/ws/chat-websocket-server.js");
      return true;
    },
  );
});

test("patch_file: host 视角下路径不存在时诊断保留真实工作区根", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-diagnostics-host-"));
  await fs.mkdir(path.join(workspacePath, "noobot/service/ws"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, "noobot/service/ws/chat-websocket-server.js"),
    "one\ntwo\n",
    "utf8",
  );
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "u-test", {
      runtime: {
        globalConfig: { tools: { execute_script: { sandboxMode: false } } },
      },
    }),
  });
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

  await assert.rejects(
    async () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_FILE_NOT_FOUND");

      assert.equal(error.details?.basePath, workspacePath);
      assert.equal(error.details?.filePath, "service/ws/chat-websocket-server.js");
      assert.equal(error.details?.attemptedPaths?.[0]?.path, "service/ws/chat-websocket-server.js");
      return true;
    },
  );
});

test("patch_file: 普通用户必须显式提供 workspace 子项目路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-normal-root-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/noobot/client/noobot-chat/src/a.txt",
    "+++ b/noobot/client/noobot-chat/src/a.txt",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ["noobot/client/noobot-chat/src/a.txt"]);
  assert.equal(
    await fs.readFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "utf8"),
    "one\nTWO\n",
  );
});

test("patch_file: strip=0 不剥离 git 前缀或虚拟根", async () => {
  const workspacePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "noobot-patch-git-project-prefix-"),
  );
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  const targetFile = path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue");
  await fs.writeFile(
    targetFile,
    [
      ".chat-message-navigator__role {",
      "  background: color-mix(in srgb, var(--noobot-fill-soft, var(--el-fill-color-lighter)) 70%, white);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/project/client/noobot-chat/src/app/ChatMessageNavigator.vue",
    "+++ b/project/client/noobot-chat/src/app/ChatMessageNavigator.vue",
    "@@ -1,3 +1,3 @@",
    " .chat-message-navigator__role {",
    "-  background: color-mix(in srgb, var(--noobot-fill-soft, var(--el-fill-color-lighter)) 70%, white);",
    "+  background: color-mix(in srgb, var(--noobot-fill-soft, var(--el-fill-color-lighter)) 70%, var(--noobot-panel-bg, var(--el-bg-color-overlay)));",
    " }",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 0 }),
    /not found|invalid/i,
  );
});

test("patch_file: 不扫描父工作区猜测唯一子项目", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-parent-workspace-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/modules/session"), {
    recursive: true,
  });
  const targetFile = path.join(
    repoPath,
    "client/noobot-chat/src/modules/session/SessionListPanel.vue",
  );
  await fs.writeFile(
    targetFile,
    [".session-hover-popover.el-popover.el-popper {", "  padding: 12px 14px;", "}", ""].join("\n"),
    "utf8",
  );
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/client/noobot-chat/src/modules/session/SessionListPanel.vue",
    "+++ b/client/noobot-chat/src/modules/session/SessionListPanel.vue",
    "@@ -1,3 +1,4 @@",
    " .session-hover-popover.el-popover.el-popper {",
    "   padding: 12px 14px;",
    "+  background: var(--noobot-panel-bg);",
    " }",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
    /not found/i,
  );
});

test("patch_file: staticInfo rootDirectory 不改变 workspace 相对路径基准", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-root-directory-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  const targetFile = path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue");
  await fs.writeFile(
    targetFile,
    [
      ".chat-message-navigator-popover.el-popover.el-popper {",
      "  padding: 12px 14px;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "u-test", {
      runtime: {
        systemRuntime: {
          staticInfo: {
            directories: {
              view: "host",
              rootDirectory: repoPath,
              currentDirectory: repoPath,
              opsWorkdir: path.join(repoPath, "runtime/ops_workdir"),
              allowedRoots: [workspacePath],
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/client/noobot-chat/src/app/ChatMessageNavigator.vue",
    "+++ b/client/noobot-chat/src/app/ChatMessageNavigator.vue",
    "@@ -1,3 +1,4 @@",
    " .chat-message-navigator-popover.el-popover.el-popper {",
    "   padding: 12px 14px;",
    "+  background: var(--noobot-panel-bg);",
    " }",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
    /not found/i,
  );
});

test("patch_file: 超级管理员也不扫描项目根解析虚拟路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-ambiguous-root-"));
  for (const repoName of ["repo-a", "repo-b"]) {
    const repoPath = path.join(workspacePath, repoName);
    await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
    await fs.mkdir(path.join(repoPath, "client"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "client/a.txt"), `${repoName}\ntwo\n`, "utf8");
  }
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "admin", {
      runtime: {
        systemRuntime: {
          isSuperUser: true,
          userId: "admin",
          sessionId: "s-1",
          rootSessionId: "s-1",
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const diff = [
    "--- a/project/client/a.txt",
    "+++ b/project/client/a.txt",
    "@@ -1,2 +1,2 @@",
    " repo-a",
    "-two",
    "+TWO",
    "",
  ].join("\n");

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", format: "unified_diff", patch: diff, strip: 1 }),
    /not found|invalid/i,
  );
});
