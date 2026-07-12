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

test("search: 支持搜索文件和文本", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src", "a.js"), "alpha\nbeta\nAlpha2\n", "utf8");
  await fs.writeFile(path.join(basePath, "src", "skip.txt"), "alpha\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "search");
  assert.ok(tool);

  const fileResult = parseToolResult(
    await tool.invoke({ source: "files", query: "alpha", path: "src", glob: "*.js", maxResults: 5 }),
  );
  assert.equal(fileResult.ok, true);
  assert.equal(fileResult.matches.length, 2);
  assert.equal(fileResult.matches[0].filePath, "src/a.js");
  assert.equal(fileResult.matches[0].line, 1);
  assert.equal(fileResult.matches[1].line, 3);

  const textResult = parseToolResult(
    await tool.invoke({ source: "text", query: "b.t", isRegex: true, text: "aa\nbet\ncc" }),
  );
  assert.equal(textResult.ok, true);
  assert.equal(textResult.matches.length, 1);
  assert.equal(textResult.matches[0].line, 2);
});

test("search: files search rejects promptly when runtime abort signal is already aborted", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-abort-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src", "a.js"), "alpha\n", "utf8");
  const abortController = new AbortController();
  abortController.abort(new DOMException("stop requested", "AbortError"));
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: { abortSignal: abortController.signal },
    }),
  });
  const tool = tools.find((item) => item?.name === "search");
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ source: "files", query: "alpha", path: "src", glob: "*.js" }),
    (error) => error?.name === "AbortError" || /stop requested|aborted/i.test(String(error?.message || error)),
  );
});

test("read_file: 超级管理员可以读取工作区外文件", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-super-read-"));
  const basePath = path.join(rootPath, "workspace");
  const outsidePath = path.join(rootPath, "outside.txt");
  await fs.mkdir(basePath, { recursive: true });
  await fs.writeFile(outsidePath, "outside\ncontent\n", "utf8");

  const regularTools = createFileTool({
    agentContext: buildAgentContext(basePath, "user", {
      runtime: {
        globalConfig: { superAdmin: { userId: "admin" } },
      },
    }),
  });
  const regularReadTool = regularTools.find((item) => item?.name === "read_file");
  assert.ok(regularReadTool);
  await assert.rejects(
    () => regularReadTool.invoke({ filePath: outsidePath, includeLineNumbers: false }),
    /路径超出允许范围|path out of scope/,
  );

  const superTools = createFileTool({
    agentContext: buildAgentContext(basePath, "admin", {
      runtime: {
        globalConfig: { superAdmin: { userId: "admin" } },
        systemRuntime: { isSuperUser: true },
      },
    }),
  });
  const superReadTool = superTools.find((item) => item?.name === "read_file");
  assert.ok(superReadTool);
  const result = parseToolResult(
    await superReadTool.invoke({ filePath: outsidePath, includeLineNumbers: false }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "outside\ncontent");
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
  const applyResult = parseToolResult(await tool.invoke({ format: "apply_patch", patch: applyPatch }));
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
    await tool.invoke({ format: "unified_diff", patch: diff, strip: 1, dryRun: true }),
  );
  assert.equal(dryRunResult.ok, true);
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");

  const diffResult = parseToolResult(await tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }));
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

  const result = parseToolResult(await tool.invoke({ patch: gitDiff }));
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

  const result = parseToolResult(await tool.invoke({ format: "unified_diff", patch: badCountDiff, strip: 1 }));
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

  const result = parseToolResult(await tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }));
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

  const result = parseToolResult(await tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }));
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
    await tool.invoke({ format: "unified_diff", patch: diff, strip: 1, root: "noobot", dryRun: true }),
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
    await tool.invoke({ format: "unified_diff", patch: diff, strip: 1, root: "noobot" }),
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
    await tool.invoke({ format: "unified_diff", patch: diff, strip: 1, root: "app\\" }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFiles, ["app/service/ws/chat-websocket-server.js"]);
  assert.equal(await fs.readFile(path.join(appPath, "service/ws/chat-websocket-server.js"), "utf8"), "one\nTWO\n");
});

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

test("patch_file: 路径不存在时返回 workspace 与候选路径诊断", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-diagnostics-"));
  await fs.mkdir(path.join(workspacePath, "noobot/service/ws"), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "noobot/service/ws/chat-websocket-server.js"), "one\ntwo\n", "utf8");
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
    async () => tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }),
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

test("patch_file: 普通用户不会跨 workspace 子项目猜测虚拟 project 路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-normal-root-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "one\ntwo\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(workspacePath) });
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

  await assert.rejects(
    () => tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }),
    /文件不存在|file not found/i,
  );
  assert.equal(await fs.readFile(path.join(repoPath, "client/noobot-chat/src/a.txt"), "utf8"), "one\ntwo\n");
});

test("patch_file: 超级管理员虚拟路径命中多个项目根时返回歧义错误", async () => {
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
        systemRuntime: { isSuperUser: true, userId: "admin", sessionId: "s-1", rootSessionId: "s-1" },
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
    () => tool.invoke({ format: "unified_diff", patch: diff, strip: 1 }),
    /ambiguous patch path/i,
  );
});

test("patch_file: 不填 format 时仍自动识别旧 apply_patch 格式", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-autodetect-"));
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

  const result = parseToolResult(await tool.invoke({ patch: applyPatch }));
  assert.equal(result.ok, true);
  assert.equal(result.format, "apply_patch");
  assert.equal(await fs.readFile(path.join(basePath, "a.txt"), "utf8"), "one\nTWO\nthree\n");
});

test("patch_file: hunk 不匹配时返回带行号上下文", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-context-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\nthree\nfour\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "patch_file");
  assert.ok(tool);

  const badPatch = [
    "*** Begin Patch",
    "*** Update File: a.txt",
    "@@",
    " one",
    "-TWO",
    "+two",
    " three",
    "*** End Patch",
    "",
  ].join("\n");
  const result = parseToolResult(await tool.invoke({ format: "apply_patch", patch: badPatch }));

  assert.equal(result.toolName, "patch_file");
  assert.equal(result.ok, false);
  assert.equal(result.filePath, "a.txt");
  assert.equal(result.details.line, 1);
  assert.match(result.nearbyContent, /1 \| one/);
  assert.match(result.nearbyContent, /2 \| two/);
  assert.match(result.nearbyContent, /3 \| three/);
});
