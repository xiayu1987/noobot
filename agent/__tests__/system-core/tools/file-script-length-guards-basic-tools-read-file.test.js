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
    () => regularReadTool.invoke({ riskLevel: "low", filePath: outsidePath, includeLineNumbers: false }),
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
    await superReadTool.invoke({ riskLevel: "low", filePath: outsidePath, includeLineNumbers: false }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "outside\ncontent");
});

test("read_file: 相对路径优先基于 directories.rootDirectory", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-root-directory-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue"), "navigator\n", "utf8");
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

  const result = parseToolResult(await readTool.invoke({ riskLevel: "low",
    filePath: "client/noobot-chat/src/app/ChatMessageNavigator.vue",
    includeLineNumbers: false,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.content, "navigator");
});

test("read_file: 非沙箱兼容 /project 前缀到 directories.rootDirectory", async () => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-project-alias-"));
  const repoPath = path.join(workspacePath, "noobot");
  await fs.mkdir(path.join(repoPath, "client/noobot-chat/src/app"), { recursive: true });
  await fs.writeFile(path.join(repoPath, "client/noobot-chat/src/app/ChatMessageNavigator.vue"), "navigator\n", "utf8");
  const tools = createFileTool({
    agentContext: buildAgentContext(workspacePath, "u-test", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: { sandboxMode: false },
          },
        },
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

  const result = parseToolResult(await readTool.invoke({ riskLevel: "low",
    filePath: "/project/client/noobot-chat/src/app/ChatMessageNavigator.vue",
    includeLineNumbers: false,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.content, "navigator");
});

