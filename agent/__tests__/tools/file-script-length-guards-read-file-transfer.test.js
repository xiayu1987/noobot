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

  const result = parseToolResult(
    await tool.invoke({ riskLevel: "low", filePath: "large.txt", includeLineNumbers: false }),
  );

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.content.length, 8001);
  assert.equal(result.contentOmitted, undefined);
  assert.equal(result.transferEnvelopes, undefined);
});

test("read_file: 大文件结果由 semantic-transfer 返回源文件引用而不物化附件", async () => {
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
      attachmentService: buildAttachmentService(),
    },
  });
  const runtime = agentContext.bindings.runtime;
  const tools = createFileTool({ agentContext });
  const tool = tools.find((item) => item?.name === "read_file");
  assert.ok(tool);

  const rawToolResultText = await tool.invoke({
    riskLevel: "low",
    filePath: "runtime/ops_workdir/large_test_file.txt",
    includeLineNumbers: true,
    maxLines: 500,
  });
  const rawResult = parseToolResult(rawToolResultText);

  assert.equal(rawResult.toolName, "read_file");
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.content.length > 8000, true);
  assert.equal(rawResult.contentOmitted, undefined);
  assert.equal(rawResult.resolvedPath, hostFilePath);
  assert.equal(String(rawResult.resolvedPath || "").includes(workspaceRoot), true);
  assert.equal(rawResult.transferEnvelopes, undefined);

  const transferred = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_result_text",
    call: { id: "tool-call-read-file-overflow", name: "read_file" },
    toolResultText: rawToolResultText,
    runtime,
    agentContext,
    sessionId: "s-1",
    identity: {
      transferId: "transfer:m-1:tool:tool-call-read-file-overflow:output:tool_result_text",
      messageId: "m-1",
      sessionId: "s-1",
      turnScopeId: "t-1",
      runId: "r-1",
      producer: { type: "tool", id: "tool-call-read-file-overflow" },
    },
  });
  const result = parseToolResult(transferred.toolResultText);

  assert.equal(result.toolName, "read_file");
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, undefined);
  assert.equal(result.content, undefined);
  assert.equal(JSON.stringify(result).includes(workspaceRoot), true);
  const envelope = result.transferEnvelopes?.[0] || {};
  assert.equal(result.overflowed, true);
  assert.equal(envelope.protocol, "noobot.semantic-transfer");
  assert.equal(envelope.version, 2);
  assert.equal(envelope.payload?.mode, "source_reference");
  assert.equal(envelope.payload?.reference?.address, hostFilePath);
  assert.equal(envelope.payload?.reference?.startLine, 1);
  assert.equal(envelope.payload?.reference?.endLine, 1);
  assert.equal(JSON.stringify(envelope).includes(workspaceRoot), true);
  assert.equal(JSON.stringify(envelope).includes("/workspace/primary-user"), false);
  assert.equal("files" in envelope, false);
  assert.equal("storage" in envelope, false);
});
