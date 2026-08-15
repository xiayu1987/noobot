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
import { parseUnifiedDiff } from "../../src/tools/execution/file-patch.js";

test("search: 支持搜索文件和文本", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-"));
  await fs.mkdir(path.join(basePath, "src"), { recursive: true });
  await fs.writeFile(path.join(basePath, "src", "a.js"), "alpha\nbeta\nAlpha2\n", "utf8");
  await fs.writeFile(path.join(basePath, "src", "skip.txt"), "alpha\n", "utf8");
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === "search");
  assert.ok(tool);

  const fileResult = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      source: "files",
      query: "alpha",
      path: "src",
      glob: "*.js",
      maxResults: 5,
    }),
  );
  assert.equal(fileResult.ok, true);
  assert.equal(fileResult.matches.length, 2);
  assert.deepEqual(fileResult.matches[0].path, { view: "workspace", path: "src/a.js" });
  assert.equal(fileResult.matches[0].line, 1);
  assert.equal(fileResult.matches[1].line, 3);

  const textResult = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      source: "text",
      query: "b.t",
      isRegex: true,
      text: "aa\nbet\ncc",
    }),
  );
  assert.equal(textResult.ok, true);
  assert.equal(textResult.matches.length, 1);
  assert.equal(textResult.matches[0].line, 2);
});

test("search: global sandbox mount is searched through its logical target", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-workspace-"));
  const mountedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-mounted-"));
  await fs.mkdir(path.join(mountedRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(mountedRoot, "src/a.js"), "mounted-search-token\n", "utf8");
  const agentContext = buildAgentContext(basePath, "u-test", {
    runtime: {
      globalConfig: {
        security: {
          executionIsolation: {
            mode: "sandbox",
            sandbox: {
              provider: "docker",
              scope: "user",
              mounts: [{ source: mountedRoot, target: "/shared-code" }],
            },
          },
        },
      },
    },
  });
  const tool = createFileTool({ agentContext }).find((item) => item?.name === "search");
  const result = parseToolResult(
    await tool.invoke({
      riskLevel: "low",
      source: "files",
      query: "mounted-search-token",
      path: "/shared-code",
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].path, { view: "workspace", path: "/shared-code/src/a.js" });
});

test("search: query schema rejects an empty string before tool execution", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-search-schema-"));
  const tools = createFileTool({ agentContext: buildAgentContext(basePath) });
  const searchTool = tools.find((item) => item?.name === "search");
  assert.ok(searchTool);

  const parsed = searchTool.schema.safeParse({
    source: "files",
    query: "",
    riskLevel: "low",
  });

  assert.equal(parsed.success, false);
  assert.match(searchTool.schema.shape.query.description, /不能为空|non-empty/i);
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
    () =>
      tool.invoke({ riskLevel: "low", source: "files", query: "alpha", path: "src", glob: "*.js" }),
    (error) =>
      error?.name === "AbortError" ||
      /stop requested|aborted/i.test(String(error?.message || error)),
  );
});
