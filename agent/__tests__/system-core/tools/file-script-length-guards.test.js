import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTool } from "../../../src/system-core/tools/execution/file-tool.js";
import { createScriptTool } from "../../../src/system-core/tools/execution/script-tool.js";

function buildAgentContext(basePath = "") {
  return {
    environment: {
      workspace: { basePath },
    },
    execution: {
      controllers: {
        runtime: {
          basePath,
          userId: "u-test",
          globalConfig: {},
          userConfig: {},
          systemRuntime: {
            sessionId: "s-1",
            rootSessionId: "s-1",
            config: {},
          },
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
  const tools = createScriptTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "execute_script");
  assert.ok(tool);

  const command = "a".repeat(8001);
  const result = parseToolResult(await tool.invoke({ command }));

  assert.equal(result.toolName, "execute_script");
  assert.equal(result.ok, false);
  assert.equal(result.message, "脚本太长请分批或分脚本或分文本或追加执行");
});

test("write_file: content 超过 8000 字符时应直接返回长度错误且不写入", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-write-guard-"));
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "write_file");
  assert.ok(tool);

  const filePath = "large.txt";
  const content = "x".repeat(8001);
  const result = parseToolResult(await tool.invoke({ filePath, content }));

  assert.equal(result.toolName, "write_file");
  assert.equal(result.ok, false);
  assert.equal(result.message, "文件内容太长请分批写入");

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
  assert.equal(result.message, "文件内容太长请分批读取");
});

