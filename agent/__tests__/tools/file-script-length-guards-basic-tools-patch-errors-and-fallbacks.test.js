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
  buildAgentContext,
  parseToolResult,
} from "./helpers/file-script-length-guards-helper.js";

test("patch_file: out-of-order anchors return diagnostics without partial writes", async (t) => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-order-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  const target = path.join(basePath, "a.txt");
  const original = "icon\ngap\nicon\nlabel\n";
  await fs.writeFile(target, original, "utf8");
  const tool = createFileTool({ agentContext: buildAgentContext(basePath) }).find(
    (item) => item?.name === "patch_file",
  );
  const result = parseToolResult(
    await tool.invoke(
      {
        riskLevel: "low",
        patch:
          "*** Begin Patch\n*** Update File: a.txt\n@@\n-label\n@@ L1\n-icon\n+hidden icon\n*** End Patch",
      },
      { signal: new AbortController().signal },
    ),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "RECOVERABLE_INVALID_INPUT");
  assert.equal(result.error, "patch hunks overlap or are out of order");
  assert.deepEqual(result.path, { view: "workspace", path: "a.txt" });
  assert.equal(result.details.line, 1);
  assert.equal(result.details.cursorLine, 5);
  assert.equal(result.details.anchorLine, 1);
  assert.match(result.nearbyContent, /^ {5}1\ticon$/m);
  assert.equal(await fs.readFile(target, "utf8"), original);
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

  const result = parseToolResult(
    await tool.invoke(
      { riskLevel: "low", patch: applyPatch },
      { signal: new AbortController().signal },
    ),
  );
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
  const result = parseToolResult(
    await tool.invoke(
      { riskLevel: "low", format: "apply_patch", patch: badPatch },
      { signal: new AbortController().signal },
    ),
  );

  assert.equal(result.toolName, "patch_file");
  assert.equal(result.ok, false);
  assert.deepEqual(result.path, { view: "workspace", path: "a.txt" });
  assert.equal("resolvedPath" in result, false);
  assert.equal(result.details.line, 2);
  assert.equal(result.details.expected, "TWO");
  assert.equal(result.details.actual, "two");
  assert.match(result.nearbyContent, /^ {5}1\tone$/m);
  assert.match(result.nearbyContent, /^ {5}2\ttwo$/m);
  assert.match(result.nearbyContent, /^ {5}3\tthree$/m);
});

test("patch_file: apply_patch 无任何候选时不伪造失配行号", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-nocandidate-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\n", "utf8");
  const tool = createFileTool({ agentContext: buildAgentContext(basePath) }).find(
    (item) => item?.name === "patch_file",
  );
  const patch = [
    "*** Begin Patch",
    "*** Update File: a.txt",
    "@@",
    "-zzz",
    "+yyy",
    "*** End Patch",
    "",
  ].join("\n");
  const result = parseToolResult(
    await tool.invoke(
      { riskLevel: "low", format: "apply_patch", patch },
      { signal: new AbortController().signal },
    ),
  );

  assert.equal(result.ok, false);
  assert.equal("line" in result.details, false);
  assert.equal(result.details.expected, "zzz");
  assert.equal("nearbyContent" in result, false);
  await fs.rm(basePath, { recursive: true, force: true });
});

test("patch_file: apply_patch 多 hunk 按顺序定位并以最长前缀候选报告失配", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-multihunk-"));
  const target = path.join(basePath, "a.txt");
  await fs.writeFile(target, "a\nb\nc\nd\ne\nf\n", "utf8");
  const tool = createFileTool({ agentContext: buildAgentContext(basePath) }).find(
    (item) => item?.name === "patch_file",
  );
  const invoke = async (lines) =>
    parseToolResult(
      await tool.invoke(
        { riskLevel: "low", format: "apply_patch", patch: lines.join("\n") },
        { signal: new AbortController().signal },
      ),
    );
  const head = ["*** Begin Patch", "*** Update File: a.txt"];

  const ok = await invoke([
    ...head,
    "@@",
    " a",
    "-b",
    "+B",
    "@@",
    " e",
    "-f",
    "+F",
    "*** End Patch",
    "",
  ]);
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(target, "utf8"), "a\nB\nc\nd\ne\nF\n");

  const bad = await invoke([...head, "@@", " c", " d", "-x", "+y", "*** End Patch", ""]);
  assert.equal(bad.ok, false);
  assert.equal(bad.details.line, 5);
  assert.equal(bad.details.expected, "x");
  assert.equal(bad.details.actual, "e");
  await fs.rm(basePath, { recursive: true, force: true });
});

test("patch_file: hunk beyond EOF reports totalLines without an inverted context window", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-patch-eof-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\ntwo\n", "utf8");
  const tool = createFileTool({ agentContext: buildAgentContext(basePath) }).find(
    (item) => item?.name === "patch_file",
  );
  const patch = ["--- a.txt", "+++ a.txt", "@@ -40,2 +40,2 @@", " x", "-y", "+z", ""].join("\n");
  const result = parseToolResult(
    await tool.invoke(
      { riskLevel: "low", format: "unified_diff", patch },
      { signal: new AbortController().signal },
    ),
  );

  assert.equal(result.ok, false);
  assert.equal(result.details.line, 40);
  assert.equal(result.totalLines, 2);
  for (const field of ["contextStartLine", "contextEndLine", "nearbyContent"]) {
    assert.equal(field in result, false, field);
  }
  await fs.rm(basePath, { recursive: true, force: true });
});
