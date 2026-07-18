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

  const result = parseToolResult(await tool.invoke({ riskLevel: "low", patch: applyPatch }));
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
  const result = parseToolResult(await tool.invoke({ riskLevel: "low", format: "apply_patch", patch: badPatch }));

  assert.equal(result.toolName, "patch_file");
  assert.equal(result.ok, false);
  assert.equal(result.filePath, "a.txt");
  assert.equal(result.details.line, 1);
  assert.match(result.nearbyContent, /1 \| one/);
  assert.match(result.nearbyContent, /2 \| two/);
  assert.match(result.nearbyContent, /3 \| three/);
});
