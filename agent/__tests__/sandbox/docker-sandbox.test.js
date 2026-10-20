/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildDockerCommand } from "../../src/sandbox/docker-sandbox.js";
import { resolveExecutionIsolation } from "@noobot/execution-isolation-protocol";

test("buildDockerCommand validates mounts through docker inspect template equality", () => {
  const built = buildDockerCommand({
    basePath: "/home/xiayu/projects/noobot/workspace/primary-user",
    userId: "primary-user",
    command: "echo ok",
    workdir: "/workspace/primary-user",
    isolation: resolveExecutionIsolation({
      security: {
        executionIsolation: {
          mode: "sandbox",
          sandbox: {
            scope: "global",
            containerName: "noobot-script-sandbox",
            mounts: [
              {
                source: "/home/xiayu/projects/noobot",
                target: "/project",
                readOnly: true,
              },
            ],
          },
        },
      },
    }),
  });

  assert.equal(built.executable, "docker");
  assert.deepEqual(built.createArgs, [
    "create",
    "--init",
    "--name",
    "noobot-script-sandbox",
    "--mount",
    "type=bind,source=/home/xiayu/projects/noobot/workspace,target=/workspace",
    "--mount",
    "type=bind,source=/home/xiayu/projects/noobot,target=/project,readonly",
    "nikolaik/python-nodejs:python3.12-nodejs26-bookworm",
    "sleep",
    "infinity",
  ]);
  assert.deepEqual(built.inspectArgs, ["container", "inspect", "noobot-script-sandbox"]);
  assert.deepEqual(built.startArgs, ["start", "noobot-script-sandbox"]);
  assert.equal(built.execArgs[0], "exec");
  assert.equal(built.execArgs[7], "noobot-script-sandbox");
  assert.match(built.execArgs[4], /^NOOBOT_EXECUTION_TOKEN=/);
  assert.match(
    built.executionToken,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.ok(built.execArgs.includes(`NOOBOT_EXECUTION_TOKEN=${built.executionToken}`));
});

test("buildDockerCommand uses protocol-owned user and global workspace projections", () => {
  const userIsolation = resolveExecutionIsolation({
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: { scope: "user", containerName: "noobot-script-sandbox" },
      },
    },
  });
  const userBuilt = buildDockerCommand({
    basePath: "/srv/workspaces/alice",
    userId: "alice",
    command: "pwd",
    isolation: userIsolation,
    workdir: "/workspace/runtime/ops_workdir",
  });
  assert.equal(userBuilt.containerName, "noobot-script-sandbox-alice");
  assert.equal(userBuilt.workspaceSource, "/srv/workspaces/alice");
  assert.equal(userBuilt.workspaceTarget, "/workspace");
  assert.equal(userBuilt.workdir, "/workspace/runtime/ops_workdir");

  const globalIsolation = resolveExecutionIsolation({
    security: {
      executionIsolation: {
        mode: "sandbox",
        sandbox: { scope: "global", containerName: "noobot-script-sandbox" },
      },
    },
  });
  const globalBuilt = buildDockerCommand({
    basePath: "/srv/workspaces/alice",
    userId: "alice",
    command: "pwd",
    isolation: globalIsolation,
    workdir: "/workspace/alice",
  });
  assert.equal(globalBuilt.containerName, "noobot-script-sandbox");
  assert.equal(globalBuilt.workspaceSource, "/srv/workspaces");
  assert.equal(globalBuilt.workspaceTarget, "/workspace");
  assert.equal(globalBuilt.workdir, "/workspace/alice");
});

test("buildDockerCommand requires explicit userId and workdir", () => {
  const isolation = resolveExecutionIsolation({
    security: { executionIsolation: { mode: "sandbox", sandbox: { scope: "user" } } },
  });
  const input = {
    basePath: "/srv/workspaces/alice",
    userId: "alice",
    command: "pwd",
    isolation,
    workdir: "/workspace",
  };
  assert.throws(() => buildDockerCommand({ ...input, userId: "" }), /requires userId/);
  assert.throws(() => buildDockerCommand({ ...input, workdir: "" }), /requires workdir/);
});
