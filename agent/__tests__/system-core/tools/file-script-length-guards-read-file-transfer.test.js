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

test("read_file: 具体工具不判断大文件，原始内容交由 semantic-transfer 处理", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-read-guard-"));
  const filePath = path.join(basePath, "large.txt");
  await fs.writeFile(filePath, "y".repeat(8001), "utf8");

  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", filePath: "large.txt", includeLineNumbers: false }));

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content.length, 8001);
  assert.equal(result.contentOmitted, undefined);
  assert.equal(result.transferEnvelopes, undefined);
});

test("read_file: 大文件原始结果由 semantic-transfer 转为沙箱视角 original-file envelope", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-root-"));
  const basePath = path.join(workspaceRoot, "primary-user");
  const hostFilePath = path.join(basePath, "runtime/ops_workdir/large_test_file.txt");
  await fs.mkdir(path.dirname(hostFilePath), { recursive: true });
  await fs.writeFile(hostFilePath, "y".repeat(8001), "utf8");

  const agentContext = buildAgentContext(basePath, "primary-user", {
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

  const rawToolResultText = await tool.invoke({ riskLevel: "low",
      filePath: "/workspace/primary-user/runtime/ops_workdir/large_test_file.txt",
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
  assert.equal("filePath" in result.transferEnvelopes?.[0], false);
  assert.equal(result.transferEnvelopes?.[0]?.files?.[0]?.filePath, "/workspace/primary-user/runtime/ops_workdir/large_test_file.txt");
  assert.equal(result.transferEnvelopes?.[0]?.files?.[0]?.pathView?.sandboxPath, "/workspace/primary-user/runtime/ops_workdir/large_test_file.txt");
  assert.equal(result.transferEnvelopes?.[0]?.storage?.originalFile, true);
  assert.equal(result.transferEnvelopes?.[0]?.storage?.persisted, false);
});
