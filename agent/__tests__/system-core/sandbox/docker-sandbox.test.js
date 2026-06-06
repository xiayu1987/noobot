/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildDockerCommand } from "../../../src/system-core/sandbox/docker-sandbox.js";

test("buildDockerCommand validates mounts through docker inspect template equality", () => {
  const built = buildDockerCommand({
    userRoot: "/home/xiayu/projects/noobot/workspace/admin",
    userId: "admin",
    command: "echo ok",
    scriptConfig: {
      dockerContainerScope: "global",
      dockerContainerName: "noobot-script-sandbox",
      dockerMounts: [
        {
          source: "/home/xiayu/projects/noobot",
          target: "/project",
        },
      ],
    },
  });

  assert.doesNotMatch(built.cmd, /_NOOBOT_MOUNT_LINES/);
  assert.match(built.cmd, /eq \.Source \\"\/home\/xiayu\/projects\/noobot\/workspace\\"/);
  assert.match(built.cmd, /eq \.Destination \\"\/workspace\\"/);
  assert.match(built.cmd, /eq \.Source \\"\/home\/xiayu\/projects\/noobot\\"/);
  assert.match(built.cmd, /eq \.Destination \\"\/project\\"/);
  assert.match(built.cmd, /grep -Fqx "__NOOBOT_MOUNT_0__"/);
  assert.match(built.cmd, /grep -Fqx "__NOOBOT_MOUNT_1__"/);
});
