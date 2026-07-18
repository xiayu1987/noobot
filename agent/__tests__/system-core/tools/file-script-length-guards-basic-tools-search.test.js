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

test("search: 支持搜索文件和文本", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src", "a.js"), "alpha\nbeta\nAlpha2\n", "utf8");
  await fs.writeFile(path.join(basePath, "src", "skip.txt"), "alpha\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "search");
  assert.ok(tool);

  const fileResult = parseToolResult(
    await tool.invoke({ riskLevel: "low", source: "files", query: "alpha", path: "src", glob: "*.js", maxResults: 5 }),
  );
  assert.equal(fileResult.ok, true);
  assert.equal(fileResult.matches.length, 2);
  assert.equal(fileResult.matches[0].filePath, "src/a.js");
  assert.equal(fileResult.matches[0].line, 1);
  assert.equal(fileResult.matches[1].line, 3);

  const textResult = parseToolResult(
    await tool.invoke({ riskLevel: "low", source: "text", query: "b.t", isRegex: true, text: "aa\nbet\ncc" }),
  );
  assert.equal(textResult.ok, true);
  assert.equal(textResult.matches.length, 1);
  assert.equal(textResult.matches[0].line, 2);
});

test("search: files search rejects promptly when runtime abort signal is already aborted", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-abort-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src", "a.js"), "alpha\n", "utf8");
  const abortController = new AbortController();
  abortController.abort(new DOMException("stop requested", "AbortError"));
  const tools = createFileTool({
    agentContext: buildAgentContext(basePath, "u-test", {
      runtime: { abortSignal: abortController.signal },
    }),
  });
  const tool = tools.find((item) => item?.name === "search");
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ riskLevel: "low", source: "files", query: "alpha", path: "src", glob: "*.js" }),
    (error) => error?.name === "AbortError" || /stop requested|aborted/i.test(String(error?.message || error)),
  );
});

