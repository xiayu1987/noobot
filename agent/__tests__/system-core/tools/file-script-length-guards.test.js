import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTool } from "../../../src/system-core/tools/execution/file-tool.js";
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

test("execute_script: command 超过 8000 字符时应直接返回长度错误", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-script-guard-"));
  const tools = createScriptTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        sharedTools: {
          semanticTransfer: {
            async transferSemanticContent() {
              return {
                compactToolPayload: {
                  transferFiles: [
                    { attachmentId: "att-script", transferFilePath: "runtime/attach/cmd.txt" },
                  ],
                },
              };
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const command = "a".repeat(8001);
  const result = parseToolResult(await tool.invoke({ command }));

  assert.equal(result.toolName, "execute_script");
  assert.equal(result.ok, false);
  assert.equal(result.message, "脚本内容过长，请分批执行或拆分脚本/文本后重试");
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].attachmentId, "att-script");
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

test("write_file: content 超过 8000 字符时应直接返回长度错误且不写入", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-guard-"));
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: {
        sharedTools: {
          semanticTransfer: {
            async transferSemanticContent() {
              return {
                compactToolPayload: {
                  transferFiles: [
                    { attachmentId: "att-file", transferFilePath: "runtime/attach/content.txt" },
                  ],
                },
              };
            },
          },
        },
      },
    }),
  });
  const tool = tools.find((item) => item?.name === "write_file");
  assert.ok(tool);

  const filePath = "large.txt";
  const content = "x".repeat(8001);
  const result = parseToolResult(await tool.invoke({ filePath, content }));

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, false);
  assert.equal(result.message, "文件内容过长，请分批写入");
  assert.equal(Array.isArray(result.transferFiles), true);
  assert.equal(result.transferFiles.length, 1);
  assert.equal(result.transferFiles[0].attachmentId, "att-file");

  await assert.rejects(() => fs.access(path.join(basePath, filePath)));
});

test("read_file: 文件内容超过 8000 字符时应直接返回长度错误", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-guard-"));
  const filePath = path.join(basePath, "large.txt");
  await fs.writeFile(filePath, "y".repeat(8001), "utf8");

  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(await tool.invoke({ filePath: "large.txt" }));

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, false);
  assert.equal(result.message, "文件内容过长，请分批读取");
});

test("read_file: should map docker sandbox /workspace/<userId> path to user workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const filePath = path.join(basePath, "runtime/ops_workdir/result.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{\"ok\":true}", "utf8");

  const tools = createFileTool({ agentContext: buildAgentContext(basePath, "admin") });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(
    await tool.invoke({
      filePath: "/workspace/admin/runtime/ops_workdir/result.json",
    }),
  );

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | {\"ok\":true}");
  assert.equal(result.includeLineNumbers, true);
  assert.equal(result.resolvedPath, filePath);
});

test("read_file: should allow mapped sandbox path that points to mounted host directory", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "admin");
  const mountedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-mounted-root-"));
  const mountedFile = path.join(mountedRoot, "sandbox-mounted.txt");
  await fs.writeFile(mountedFile, "mounted-ok", "utf8");

  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "admin", {
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
    }),
  });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(
    await tool.invoke({
      filePath: "/project/sandbox-mounted.txt",
    }),
  );

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | mounted-ok");
  assert.equal(result.resolvedPath, mountedFile);
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

  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "admin", {
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
    }),
  });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(
    await tool.invoke({
      filePath: "/project/agent/src/system-core/tools/execution/file-tool.js",
    }),
  );

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content, "1 | project-mounted-ok");
  assert.equal(result.resolvedPath, projectFile);
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
