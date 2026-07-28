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
      args: {
        source: "text",
        query: "needle",
        text: "x".repeat(LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars + 1),
      },
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

test("patch_file: patch 超过 semantic-transfer 阈值时保存附件并直接提示", async () => {
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
      args: {
        format: "apply_patch",
        patch: "x".repeat(LENGTH_THRESHOLDS.semanticTransfer.toolInputOverflowChars + 1),
      },
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
