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
    userRoot: "/home/xiayu/projects/noobot/workspace/primary-user",
    userId: "primary-user",
    command: "echo ok",
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

  assert.doesNotMatch(built.cmd, /_NOOBOT_MOUNT_LINES/);
  assert.match(built.cmd, /eq \.Source \\"\/home\/xiayu\/projects\/noobot\/workspace\\"/);
  assert.match(built.cmd, /eq \.Destination \\"\/workspace\\"/);
  assert.match(built.cmd, /eq \.Source \\"\/home\/xiayu\/projects\/noobot\\"/);
  assert.match(built.cmd, /eq \.Destination \\"\/project\\"/);
  assert.match(built.cmd, /eq \.RW false/);
  assert.match(built.cmd, /:\"\/project\":ro/);
  assert.match(built.cmd, /grep -Fqx "__NOOBOT_MOUNT_0__"/);
  assert.match(built.cmd, /grep -Fqx "__NOOBOT_MOUNT_1__"/);
  assert.match(built.cmd, /docker create --init --name "noobot-script-sandbox"/);
  assert.match(built.cmd, /-e NOOBOT_EXECUTION_TOKEN=/);
  assert.match(
    built.executionToken,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.match(built.cmd, new RegExp(built.executionToken));
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
    userRoot: "/srv/workspaces/alice",
    userId: "alice",
    command: "pwd",
    isolation: userIsolation,
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
    userRoot: "/srv/workspaces/alice",
    userId: "alice",
    command: "pwd",
    isolation: globalIsolation,
  });
  assert.equal(globalBuilt.containerName, "noobot-script-sandbox");
  assert.equal(globalBuilt.workspaceSource, "/srv/workspaces");
  assert.equal(globalBuilt.workspaceTarget, "/workspace");
  assert.equal(globalBuilt.workdir, "/workspace/alice/runtime/ops_workdir");
});
