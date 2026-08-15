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
function createContext(
  basePath,
  { safeConfirm = true, safeConfirmLevel = "low", confirmed = true, requests = [] } = {},
) {
  const bridge = {
    async requestUserInteraction(payload) {
      requests.push(payload);
      return { confirmed };
    },
  };
  return buildAgentContext(basePath, "u-risk", {
    runtime: {
      systemRuntime: {
        userId: "u-risk",
        sessionId: "s-risk",
        rootSessionId: "s-risk",
        config: { safeConfirm, safeConfirmLevel },
      },
      userInteractionBridge: bridge,
    },
  });
}

test("model-declared critical risk raises a server-classified workspace read", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-threshold-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "safe", "utf8");
  const requests = [];
  const tool = getTool(
    createContext(basePath, { safeConfirmLevel: "critical", requests }),
    "read_file",
  );
  await tool.invoke({ filePath: "a.txt", riskLevel: "critical" });
  assert.equal(requests.length, 1);
  assert.match(requests[0].content, /critical/);
});

function getTool(context, name) {
  const tool = createFileTool({ agentContext: context }).find((item) => item?.name === name);
  assert.ok(tool);
  return tool;
}

test("file risk schema requires the model declaration", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-schema-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "safe", "utf8");
  const tool = getTool(createContext(basePath, { safeConfirm: false }), "read_file");
  assert.equal(Object.hasOwn(tool.schema.shape, "riskLevel"), true);
  const result = parseToolResult(await tool.invoke({ filePath: "a.txt", riskLevel: "critical" }));
  assert.equal(result.ok, true);
});

test("server-classified read confirms after normalization and reconfirms each call", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-read-"));
  const secretPath = "private-token-file.txt";
  const secretValue = "ghp_should_not_appear_in_confirmation";
  await fs.writeFile(path.join(basePath, secretPath), secretValue, "utf8");
  const requests = [];
  const tool = getTool(
    createContext(basePath, { requests, safeConfirmLevel: "critical" }),
    "read_file",
  );

  for (let index = 0; index < 2; index += 1) {
    const result = parseToolResult(await tool.invoke({ filePath: secretPath, riskLevel: "low" }));
    assert.equal(result.ok, true);
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.toolName, "read_file");
    assert.match(request.content, new RegExp(secretPath));
    assert.doesNotMatch(request.content, new RegExp(secretValue));
  }
});

test("server-classified writes are blocked at the medium-risk confirmation threshold", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-block-"));
  const target = path.join(basePath, "blocked.txt");
  const rejected = createContext(basePath, { confirmed: false, safeConfirmLevel: "high" });
  const writeTool = getTool(rejected, "write_file");
  await assert.rejects(
    () =>
      writeTool.invoke({ filePath: "blocked.txt", content: "must-not-write", riskLevel: "low" }),
    /cancel|取消|confirm/i,
  );
  await assert.rejects(() => fs.stat(target), /ENOENT/);
});

test("server-classified patch confirmation omits patch content", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-content-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\n", "utf8");
  const requests = [];
  const context = createContext(basePath, { requests, safeConfirmLevel: "high" });
  const searchTool = getTool(context, "search");
  const patchTool = getTool(context, "patch_file");
  const query = "highly-secret-query";
  const text = "caller-private-text";
  await searchTool.invoke({ source: "text", query, text, riskLevel: "critical" });
  const patch =
    "*** Begin Patch\n*** Update File: a.txt\n@@\n-one\n+private-replacement\n*** End Patch\n";
  await patchTool.invoke({ format: "apply_patch", patch, dryRun: false, riskLevel: "low" });
  assert.equal(requests.length, 2);
  const combined = requests.map((item) => item.content).join("\n");
  for (const sensitive of [query, text, patch, "private-replacement"]) {
    assert.equal(combined.includes(sensitive), false);
  }
});
