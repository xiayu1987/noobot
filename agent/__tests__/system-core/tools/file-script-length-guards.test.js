import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTool } from "../../../src/system-core/tools/execution/file-tool.js";
import { executeToolCall } from "../../../src/system-core/agent/core/execution/tool-runner.js";
import { transferSemanticContent } from "../../../src/system-core/semantic-transfer/index.js";
import {
  buildExecutionWorkspaceMeta,
  buildScriptExecutionMeta,
  createScriptTool,
} from "../../../src/system-core/tools/execution/script-tool.js";

function buildAgentContext(basePath = "", userId = "u-test", overrides = {}) {
  const runtimeOverrides =
    overrides?.runtime && typeof overrides.runtime === "object"
      ? overrides.runtime
      : {};
  const sharedTools =
    runtimeOverrides?.sharedTools && typeof runtimeOverrides.sharedTools === "object"
      ? runtimeOverrides.sharedTools
      : {};
  return {
    environment: {
      workspace: { basePath },
      identity: { userId },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId,
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
          userConfig: {},
          systemRuntime: {
            userId,
            sessionId: "s-1",
            rootSessionId: "s-1",
            config: {},
          },
          sharedTools,
          ...runtimeOverrides,
        },
      },
    },
  };
}

function parseToolResult(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

function buildAttachmentService() {
  return {
    async ingestGeneratedArtifacts(payload = {}) {
      return (Array.isArray(payload.artifacts) ? payload.artifacts : []).map((artifact = {}, index) => ({
        attachmentId: `att-tool-input-${index + 1}`,
        sessionId: payload.sessionId,
        attachmentSource: payload.attachmentSource,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: Buffer.from(String(artifact.contentBase64 || ""), "base64").length,
        path: `/host/${artifact.name}`,
        relativePath: `runtime/attach/${artifact.name}`,
        generatedByModel: true,
        generationSource: payload.generationSource,
      }));
    },
  };
}

test("execute_script: command 超过 200000 字符时由 semantic-transfer 保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("execute_script concrete tool must not be invoked for overlong input");
    },
  };

  const command = "a".repeat(200001);
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
    agentContext: buildAgentContext(basePath, "admin", {
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
              return "/workspace/admin/runtime/ops_workdir";
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
    agentContext: buildAgentContext(basePath, "admin", {
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
      userId: "admin",
      sharedTools: {
        resolveSandboxPath(payload = {}) {
          const hostPath = String(payload?.hostPath || payload?.path || "").trim();
          if (hostPath === runtimeOpsWorkdir) return "/workspace/admin/runtime/ops_workdir";
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
    absolutePath: "/workspace/admin/runtime/ops_workdir",
    view: "sandbox",
    defaultWorkdir: "/workspace/admin/runtime/ops_workdir",
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
    workspace: "/host/admin/runtime/ops_workdir",
    dockerConfig: {
      dockerMounts: [{ source: "/host/project", target: "/project" }],
    },
    docker: {
      image: "example/script:latest",
      containerName: "noobot-script-sandbox",
      scope: "global",
      workdir: "/workspace/admin/runtime/ops_workdir",
      dockerMounts: [{ source: "/host/project", target: "/project" }],
    },
  });

  assert.equal(meta.runtime.image, "example/script:latest");
  assert.equal(meta.runtime.container, undefined);
  assert.equal(meta.runtime.scope, undefined);
  assert.equal(meta.mounts, undefined);
  assert.equal(meta.workspace.absolutePath, "/workspace/admin/runtime/ops_workdir");
  assert.equal(meta.workspace.view, "sandbox");
  assert.deepEqual(meta.workspace.allowedRoots, ["/workspace", "/project"]);
});

test("write_file: content 超过 200000 字符时由 semantic-transfer 保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("write_file concrete tool must not be invoked for overlong input");
    },
  };

  const filePath = "large.txt";
  const content = "x".repeat(200001);
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
    agentContext: buildAgentContext(basePath, "admin", {
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

  const runtime = buildAgentContext(basePath, "admin", {
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
      args: { filePath: "runtime/ops_workdir/write-ok.txt", content: "ok" },
    },
    tool,
    runtime,
    agentContext: buildAgentContext(basePath, "admin", { runtime }),
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, path.join(basePath, "runtime/ops_workdir/write-ok.txt"));
});

test("write_file: 启用沙箱返回沙箱路径视角", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-sandbox-view-"));
  const basePath = path.join(workspaceRoot, "admin");
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "admin", {
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

  const runtime = buildAgentContext(basePath, "admin", {
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
      args: { filePath: "runtime/ops_workdir/write-ok.txt", content: "ok" },
    },
    tool,
    runtime,
    agentContext: buildAgentContext(basePath, "admin", { runtime }),
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, "/workspace/admin/runtime/ops_workdir/write-ok.txt");
  assert.equal(String(result.resolvedPath || "").includes(workspaceRoot), false);
});

test("search: text 输入超过上限时由 semantic-transfer 保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("search concrete tool must not be invoked for overlong text input");
    },
  };

  const runnerResult = await executeToolCall({
    call: {
      id: "call_long_search_text",
      name: "search",
      args: { source: "text", query: "needle", text: "x".repeat(200001) },
    },
    tool,
    runtime: {
      basePath,
      systemRuntime: { userId: "u-test", sessionId: "s-search" },
      globalConfig: {},
      userConfig: {},
      attachmentService: buildAttachmentService(),
    },
    agentContext: buildAgentContext(basePath, "u-test"),
    sessionId: "s-search",
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(invoked, false);
  assert.equal(runnerResult.success, true);
  assert.equal(result.toolName, "search");
  assert.equal(result.ok, false);
  assert.equal(result.message, "text is too long; search in smaller chunks");
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].name, "search-text.tool-input.txt");
  assert.equal(typeof result.transferFiles[0].transferFilePath, "string");
  assert.equal(result.toolInputOverflow?.field, "text");
});

test("patch_file: patch 超过 200000 字符时由 semantic-transfer 保存附件并直接提示", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-guard-"));
  let invoked = false;
  const tool = {
    async invoke() {
      invoked = true;
      throw new Error("patch_file concrete tool must not be invoked for overlong input");
    },
  };

  const runnerResult = await executeToolCall({
    call: {
      id: "call_long_patch",
      name: "patch_file",
      args: { format: "apply_patch", patch: "x".repeat(200001) },
    },
    tool,
    runtime: {
      basePath,
      systemRuntime: { userId: "u-test", sessionId: "s-patch" },
      globalConfig: {},
      userConfig: {},
      attachmentService: buildAttachmentService(),
    },
    agentContext: buildAgentContext(basePath, "u-test"),
    sessionId: "s-patch",
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(invoked, false);
  assert.equal(runnerResult.success, true);
  assert.equal(result.toolName, "patch_file");
  assert.equal(result.ok, false);
  assert.equal(result.message, "补丁内容过长，请分批应用或拆分 patch 后重试");
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].name, "patch-file-patch.tool-input.diff");
  assert.equal(typeof result.transferFiles[0].transferFilePath, "string");
  assert.equal(result.toolInputOverflow?.field, "patch");
});

test("read_file: 具体工具不判断大文件，原始内容交由 semantic-transfer 处理", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-guard-"));
  const filePath = path.join(basePath, "large.txt");
  await fs.writeFile(filePath, "y".repeat(8001), "utf8");

  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(await tool.invoke({ filePath: "large.txt", includeLineNumbers: false }));

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content.length, 8001);
  assert.equal(result.contentOmitted, undefined);
  assert.equal(result.transferEnvelopes, undefined);
});

test("read_file: 大文件原始结果由 semantic-transfer 转为沙箱视角 original-file envelope", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const hostFilePath = path.join(basePath, "runtime/ops_workdir/large_test_file.txt");
  await fs.mkdir(path.dirname(hostFilePath), { recursive: true });
  await fs.writeFile(hostFilePath, "y".repeat(8001), "utf8");

  const agentContext = buildAgentContext(basePath, "admin", {
    runtime: {
      userConfig: {
        tools: {
          maxToolResultChars: 512,
        },
      },
    },
  });
  const runtime = agentContext.execution.controllers.runtime;
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const rawToolResultText = await tool.invoke({
      filePath: "/workspace/admin/runtime/ops_workdir/large_test_file.txt",
      includeLineNumbers: true,
      maxLines: 500,
  });
  const rawResult = parseToolResult(rawToolResultText);

  assert.equal(rawResult.toolName, "read_file");
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.content.length > 8000, true);
  assert.equal(rawResult.contentOmitted, undefined);
  assert.equal(rawResult.resolvedPath, hostFilePath);
  assert.equal(rawResult.transferEnvelopes, undefined);

  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call: { name: "read_file" },
    toolResultText: rawToolResultText,
    runtime,
    agentContext,
  });
  const result = parseToolResult(transferred.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, undefined);
  assert.equal(result.content, undefined);
  assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
  assert.equal(result.overflow_strategy, "original_file_reference");
  assert.equal(result.transferEnvelopes?.[0]?.protocol, "noobot.semantic-transfer");
  assert.equal(result.transferEnvelopes?.[0]?.filePath, "/workspace/admin/runtime/ops_workdir/large_test_file.txt");
  assert.equal(result.transferEnvelopes?.[0]?.storage?.originalFile, true);
  assert.equal(result.transferEnvelopes?.[0]?.storage?.persisted, false);
});

test("read_file: should map docker sandbox /workspace/<userId> path to user workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const filePath = path.join(basePath, "runtime/ops_workdir/result.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{\"ok\":true}", "utf8");

  const agentContext = buildAgentContext(basePath, "admin");
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const runnerResult = await executeToolCall({
    call: {
      id: "call_read_workspace_path",
      name: "read_file",
      args: { filePath: "/workspace/admin/runtime/ops_workdir/result.json" },
    },
    tool,
    runtime: agentContext.execution.controllers.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | {\"ok\":true}");
  assert.equal(result.includeLineNumbers, true);
  assert.equal(result.resolvedPath, "/workspace/admin/runtime/ops_workdir/result.json");
  assert.equal(String(result.resolvedPath || "").includes(workspaceRoot), false);
});

test("read_file: should allow mapped sandbox path that points to mounted host directory", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const mountedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-mounted-root-"));
  const mountedFile = path.join(mountedRoot, "sandbox-mounted.txt");
  await fs.writeFile(mountedFile, "mounted-ok", "utf8");

  const agentContext = buildAgentContext(basePath, "admin", {
      runtime: {
        systemRuntime: {
          userId: "admin",
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
      args: { filePath: "/project/sandbox-mounted.txt" },
    },
    tool,
    runtime: agentContext.execution.controllers.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | mounted-ok");
  assert.equal(result.resolvedPath, "/project/sandbox-mounted.txt");
  assert.equal(String(result.resolvedPath || "").includes(mountedRoot), false);
});

test("read_file: should allow docker mount target path under /project", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-project-root-"));
  const projectFile = path.join(
    projectRoot,
    "agent/src/system-core/tools/execution/file-tool.js",
  );
  await fs.mkdir(path.dirname(projectFile), { recursive: true });
  await fs.writeFile(projectFile, "project-mounted-ok", "utf8");

  const agentContext = buildAgentContext(basePath, "admin", {
      runtime: {
        globalConfig: {
          tools: {
            execute_script: {
              sandboxMode: true,
              sandboxProvider: {
                default: "docker",
                docker: {
                  dockerContainerScope: "global",
                  dockerMounts: [
                    {
                      source: projectRoot,
                      target: "/project",
                    },
                  ],
                },
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
      args: { filePath: "/project/agent/src/system-core/tools/execution/file-tool.js" },
    },
    tool,
    runtime: agentContext.execution.controllers.runtime,
    agentContext,
  });
  const result = parseToolResult(runnerResult.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | project-mounted-ok");
  assert.equal(result.resolvedPath, "/project/agent/src/system-core/tools/execution/file-tool.js");
  assert.equal(String(result.resolvedPath || "").includes(projectRoot), false);
});

test("read_file: 默认返回行号且可关闭行号", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-lines-"));
  await fs.writeFile(path.join(basePath, "lines.txt"), "a\nb\nc\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const withLines = parseToolResult(await tool.invoke({ filePath: "lines.txt", startLine: 2, endLine: 3 }));
  assert.equal(withLines.ok, true);
  assert.equal(withLines.content, "2 | b\n3 | c");
  assert.equal(withLines.includeLineNumbers, true);

  const withoutLines = parseToolResult(
    await tool.invoke({ filePath: "lines.txt", startLine: 2, endLine: 3, includeLineNumbers: false }),
  );
  assert.equal(withoutLines.ok, true);
  assert.equal(withoutLines.content, "b\nc");
  assert.equal(withoutLines.includeLineNumbers, false);
});

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
