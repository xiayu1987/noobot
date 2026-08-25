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

test("read_file: reads a model attachment through its canonical identity", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-attachment-"));
  const attachmentPath = path.join(workspacePath, "runtime/attach/report.txt");
  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(attachmentPath, "native output\n", "utf8");
  const identity = {
    attachmentId: "native-output-1",
    sessionId: "s-1",
    attachmentSource: "model",
  };
  const agentContext = buildAgentContext(workspacePath, "user", {
    runtime: {
      attachmentService: {
        async getAttachmentById(request) {
          assert.deepEqual(request, { userId: "user", ...identity });
          return {
            ...identity,
            name: "report.txt",
            absolutePath: attachmentPath,
            mimeType: "text/plain",
            size: 14,
          };
        },
      },
    },
  });
  const readTool = createFileTool({ agentContext }).find((item) => item?.name === "read_file");

  const result = parseToolResult(
    await readTool.invoke({
      riskLevel: "low",
      filePath: "attachment:v1:s-1/model/native-output-1",
      includeLineNumbers: false,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.content, "native output");
  assert.equal(result.fileName, "report.txt");
  assert.deepEqual(result.path, { view: "attachment", identity });
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
    () =>
      regularReadTool.invoke({
        riskLevel: "low",
        filePath: outsidePath,
        includeLineNumbers: false,
      }),
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
    await superReadTool.invoke({
      riskLevel: "low",
      filePath: outsidePath,
      includeLineNumbers: false,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "outside\ncontent");
});

test("read_file: 越界错误不暴露宿主 allowedRoots", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-scope-error-"));
  const workspacePath = path.join(rootPath, "workspace");
  const outsidePath = path.join(rootPath, "outside.txt");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(outsidePath, "outside\n", "utf8");

  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "user", {
      runtime: { globalConfig: { superAdmin: { userId: "admin" } } },
    }),
  });
  const readTool = tools.find((item) => item?.name === "read_file");
  assert.ok(readTool);

  await assert.rejects(
    () => readTool.invoke({ riskLevel: "low", filePath: outsidePath, includeLineNumbers: false }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.scope, "workspace");
      assert.equal(error.details?.allowedRoots, undefined);
      assert.equal(JSON.stringify(error).includes(rootPath), false);
      return true;
    },
  );
});

test("read_file: 沙箱内相对路径穿越保留 workspace 视角", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-sandbox-scope-"));
  const readTool = createFileTool({
    agentContext: buildAgentContext(workspacePath, "user", {
      runtime: {
        globalConfig: {
          security: {
            executionIsolation: {
              mode: "sandbox",
              sandbox: { provider: "docker", scope: "user" },
            },
          },
        },
      },
    }),
  }).find((item) => item?.name === "read_file");
  assert.ok(readTool);

  await assert.rejects(
    () => readTool.invoke({ riskLevel: "low", filePath: "../outside.txt" }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.pathView, "workspace-relative");
      assert.equal(error.details?.error, "workspace_path_out_of_scope");
      assert.notEqual(error.details?.error, "host_path_unavailable_in_sandbox");
      return true;
    },
  );

  await assert.rejects(
    () => readTool.invoke({ riskLevel: "low", filePath: "/tmp/container-private.txt" }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_OUT_OF_SCOPE");
      assert.equal(error.details?.pathView, "sandbox-absolute");
      assert.equal(error.details?.error, "sandbox_path_not_mapped");
      assert.notEqual(error.details?.pathView, "host");
      assert.equal(error.message, "该沙箱路径未映射到共享文件根目录。");
      assert.equal(error.details?.hint, "该沙箱路径未映射到共享文件根目录。");
      return true;
    },
  );
});

test("read_file: directory returns the canonical not-a-file error", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-directory-"));
  await fs.mkdir(path.join(workspacePath, "reports"), { recursive: true });
  const readTool = createFileTool({ agentContext: buildAgentContext(workspacePath, "user") }).find(
    (item) => item?.name === "read_file",
  );
  assert.ok(readTool);

  await assert.rejects(
    () => readTool.invoke({ riskLevel: "low", filePath: "reports" }),
    (error) => {
      assert.equal(error.code, "RECOVERABLE_PATH_NOT_FILE");
      assert.deepEqual(error.details?.path, { view: "workspace", path: "reports" });
      assert.equal(String(error.message || "").includes("EISDIR"), false);
      return true;
    },
  );
});

test("read_file: 相对路径固定基于用户 workspace", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-root-directory-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue"),
    "navigator\n",
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
  const readTool = tools.find((item) => item?.name === "read_file");
  assert.ok(readTool);

  const result = parseToolResult(
    await readTool.invoke({
      riskLevel: "low",
      filePath: "noobot/client/noobot-chat/src/app/ChatMessageNavigator.vue",
      includeLineNumbers: false,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "navigator");
});

test("read_file: host 模式拒绝未配置的 /project 沙箱路径", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-project-alias-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  await fs.writeFile(
    path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue"),
    "navigator\n",
    "utf8",
  );
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "u-test", {
      runtime: {
        globalConfig: { security: { executionIsolation: { mode: "host" } } },
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
  const readTool = tools.find((item) => item?.name === "read_file");
  assert.ok(readTool);

  await assert.rejects(
    () =>
      readTool.invoke({
        riskLevel: "low",
        filePath: "/project/client/noobot-chat/src/app/ChatMessageNavigator.vue",
        includeLineNumbers: false,
      }),
    /sandbox|沙箱/i,
  );
});
