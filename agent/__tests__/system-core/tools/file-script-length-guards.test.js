import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTool } from "../../../src/system-core/tools/execution/file-tool.js";
import { createScriptTool } from "../../../src/system-core/tools/execution/script-tool.js";

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
  assert.equal(result.content, "{\"ok\":true}");
  assert.equal(result.resolvedPath, filePath);
});
