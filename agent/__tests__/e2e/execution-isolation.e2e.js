/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { createScriptTool } from "../../src/tools/execution/script-tool.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

const execFileAsync = promisify(execFile);
const TEST_IMAGE = "nikolaik/python-nodejs:python3.12-nodejs26-bookworm";
const TRANSFER_IDENTITY = Object.freeze({
  transferId: "transfer:e2e:execution-isolation",
  messageId: "message:e2e:execution-isolation",
  sessionId: "session:e2e:execution-isolation",
  turnScopeId: "turn:e2e:execution-isolation",
  runId: "run:e2e:execution-isolation",
  producer: { type: "tool", id: "call:e2e:execution-isolation" },
});

function buildAgentContext({
  basePath,
  workspaceRoot,
  userId,
  mode,
  scope,
  containerName,
  isSuperUser = false,
}) {
  return createTestAgentExecutionScope(
    {
      basePath,
      userId,
      globalConfig: {
        workspaceRoot,
        security: {
          executionIsolation: {
            mode,
            sandbox: {
              provider: "docker",
              scope,
              containerName,
              image: TEST_IMAGE,
            },
          },
        },
      },
      userConfig: {},
      systemRuntime: {
        userId,
        sessionId: "session:e2e:execution-isolation",
        rootSessionId: "session:e2e:execution-isolation",
        isSuperUser,
        config: {},
      },
    },
    { identity: { userId } },
  );
}

function scriptTool(agentContext) {
  return createScriptTool({ agentContext }).find((tool) => tool?.name === "execute_script");
}

async function invokeScript(tool, command) {
  const raw = await tool.invoke(
    { command, riskLevel: "low", executionMode: "foreground" },
    { configurable: { transferIdentity: TRANSFER_IDENTITY } },
  );
  return JSON.parse(String(raw || "{}"));
}

describe("execution isolation E2E", { concurrency: false }, () => {
  let workspaceRoot;
  let aliceRoot;
  let containerBase;

  before(async () => {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"]);
    await execFileAsync("docker", ["image", "inspect", TEST_IMAGE]);
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-isolation-e2e-"));
    aliceRoot = path.join(workspaceRoot, "alice");
    const bobRoot = path.join(workspaceRoot, "bob");
    await fs.mkdir(path.join(aliceRoot, "runtime/ops_workdir"), { recursive: true });
    await fs.mkdir(path.join(bobRoot, "runtime/ops_workdir"), { recursive: true });
    await fs.writeFile(path.join(bobRoot, "runtime/ops_workdir/secret.txt"), "BOB-SECRET", "utf8");
    containerBase = `noobot-isolation-e2e-${randomUUID()}`;
  });

  after(async () => {
    const containers = [containerBase, `${containerBase}-alice`].filter(Boolean);
    for (const containerName of containers) {
      await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => undefined);
    }
    if (workspaceRoot) await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  test("ordinary user host mode does not expose execute_script", () => {
    const agentContext = buildAgentContext({
      basePath: aliceRoot,
      workspaceRoot,
      userId: "alice",
      mode: "host",
      scope: "user",
      containerName: containerBase,
    });
    assert.equal(scriptTool(agentContext), undefined);
  });

  test("super-admin host mode executes in the authoritative user workdir", async () => {
    const agentContext = buildAgentContext({
      basePath: aliceRoot,
      workspaceRoot,
      userId: "alice",
      mode: "host",
      scope: "user",
      containerName: containerBase,
      isSuperUser: true,
    });
    const tool = scriptTool(agentContext);
    assert.ok(tool);
    const result = await invokeScript(tool, "printf 'HOST-PWD=%s' \"$PWD\"");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution?.view, "service_host_restricted");
    assert.equal(result.stdout, `HOST-PWD=${path.join(aliceRoot, "runtime/ops_workdir")}`);
  });

  test("ordinary user sandbox user scope gets a private container and workspace mount", async () => {
    const agentContext = buildAgentContext({
      basePath: aliceRoot,
      workspaceRoot,
      userId: "alice",
      mode: "sandbox",
      scope: "user",
      containerName: containerBase,
    });
    const tool = scriptTool(agentContext);
    assert.ok(tool);
    const result = await invokeScript(
      tool,
      [
        "printf 'SANDBOX-PWD=%s\\n' \"$PWD\"",
        "if [ -e /workspace/bob/runtime/ops_workdir/secret.txt ]; then exit 91; fi",
        "printf 'OTHER-USER=hidden'",
      ].join("; "),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution?.view, "workspace_sandbox");
    assert.equal(result.workspace?.path, "/workspace/runtime/ops_workdir");
    assert.equal(result.stdout, "SANDBOX-PWD=/workspace/runtime/ops_workdir\nOTHER-USER=hidden");
  });

  test("ordinary user sandbox global scope intentionally shares the workspace mount", async () => {
    const agentContext = buildAgentContext({
      basePath: aliceRoot,
      workspaceRoot,
      userId: "alice",
      mode: "sandbox",
      scope: "global",
      containerName: containerBase,
    });
    const tool = scriptTool(agentContext);
    assert.ok(tool);
    const result = await invokeScript(
      tool,
      "printf 'SANDBOX-PWD=%s\\n' \"$PWD\"; printf 'OTHER-USER='; cat /workspace/bob/runtime/ops_workdir/secret.txt",
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution?.view, "workspace_sandbox");
    assert.equal(result.workspace?.path, "/workspace/alice/runtime/ops_workdir");
    assert.equal(
      result.stdout,
      "SANDBOX-PWD=/workspace/alice/runtime/ops_workdir\nOTHER-USER=BOB-SECRET",
    );
  });
});
