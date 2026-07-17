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

function createContext(basePath, { safeConfirm = true, confirmed = true, requests = [] } = {}) {
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
        config: { safeConfirm },
      },
      userInteractionBridge: bridge,
    },
  });
}

function getTool(context, name) {
  const tool = createFileTool({ agentContext: context }).find((item) => item?.name === name);
  assert.ok(tool);
  return tool;
}

test("file risk schema: riskLevel is required and accepts four levels", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-schema-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "safe", "utf8");
  const tool = getTool(createContext(basePath, { safeConfirm: false }), "read_file");
  await assert.rejects(() => tool.invoke({ filePath: "a.txt" }), /riskLevel/);
  for (const riskLevel of ["low", "medium", "high", "critical"]) {
    const result = parseToolResult(await tool.invoke({ filePath: "a.txt", riskLevel }));
    assert.equal(result.ok, true);
  }
  await assert.rejects(() => tool.invoke({ filePath: "a.txt", riskLevel: "unknown" }), /riskLevel/);
});

test("critical read confirms before access, does not disclose parameters, and reconfirms each call", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-read-"));
  const secretPath = "private-token-file.txt";
  const secretValue = "ghp_should_not_appear_in_confirmation";
  await fs.writeFile(path.join(basePath, secretPath), secretValue, "utf8");
  const requests = [];
  const tool = getTool(createContext(basePath, { requests }), "read_file");

  for (let index = 0; index < 2; index += 1) {
    const result = parseToolResult(await tool.invoke({ filePath: secretPath, riskLevel: "critical" }));
    assert.equal(result.ok, true);
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.toolName, "read_file");
    assert.doesNotMatch(request.content, new RegExp(secretPath));
    assert.doesNotMatch(request.content, new RegExp(secretValue));
  }
});

test("critical file operations are blocked on rejection or missing bridge before access/change", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-block-"));
  const target = path.join(basePath, "blocked.txt");
  const rejected = createContext(basePath, { confirmed: false });
  const writeTool = getTool(rejected, "write_file");
  await assert.rejects(
    () => writeTool.invoke({ filePath: "blocked.txt", content: "must-not-write", riskLevel: "critical" }),
    /cancel|取消|confirm/i,
  );
  await assert.rejects(() => fs.stat(target), /ENOENT/);

  const missingBridge = buildAgentContext(basePath, "u-risk", {
    runtime: { systemRuntime: { userId: "u-risk", sessionId: "s-risk", config: { safeConfirm: true } } },
  });
  const readTool = getTool(missingBridge, "read_file");
  await assert.rejects(
    () => readTool.invoke({ filePath: "does-not-exist.txt", riskLevel: "critical" }),
    /interaction|交互|confirm/i,
  );
});

test("critical search and patch confirmation omits sensitive payloads", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-risk-content-"));
  await fs.writeFile(path.join(basePath, "a.txt"), "one\n", "utf8");
  const requests = [];
  const context = createContext(basePath, { requests });
  const searchTool = getTool(context, "search");
  const patchTool = getTool(context, "patch_file");
  const query = "highly-secret-query";
  const text = "caller-private-text";
  await searchTool.invoke({ source: "text", query, text, riskLevel: "critical" });
  const patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n-one\n+private-replacement\n*** End Patch\n";
  await patchTool.invoke({ format: "apply_patch", patch, dryRun: true, riskLevel: "critical" });
  assert.equal(requests.length, 2);
  const combined = requests.map((item) => item.content).join("\n");
  for (const sensitive of [query, text, patch, "private-replacement"]) {
    assert.equal(combined.includes(sensitive), false);
  }
});
