/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { normalizePlatform, PLATFORM, SHELL } from "@noobot/platform-compatibility/platform";

const execFileAsync = promisify(execFile);

if (normalizePlatform(process.platform) !== PLATFORM.LINUX) {
  throw new Error("The Bash orchestration test requires a Linux host");
}

for (const networkExists of [true, false]) {
  test(`Docker full suite isolates dependencies and forwards database config (network exists: ${networkExists})`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "noobot-e2e-lifecycle-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const bin = path.join(directory, "bin");
    const bashEnv = path.join(directory, "bash-env");
    const dockerLog = path.join(directory, "docker.log");
    await mkdir(bin);
    const commands = {
      docker: `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
case "$1 $2" in
  'inspect -f') printf 'false\\n' ;;
  'network inspect') exit "$TEST_NETWORK_MISSING" ;;
  'network rm') exit 99 ;;
  'rm -f')
    case "$3" in validation|validation-mcp|validation-mock) ;; *) exit 98 ;; esac ;;
esac
`,
      node: `#!/bin/sh
case "$1" in */prepare-workspace.mjs) exit 0 ;; esac
exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"
`,
      npm: "#!/bin/sh\nexit 0\n",
      curl: `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$TEST_DOCKER_LOG"
`,
    };
    for (const [name, content] of Object.entries(commands)) {
      await writeFile(path.join(bin, name), content, { mode: 0o755 });
    }
    await writeFile(bashEnv, 'export PATH="$(cd "$(dirname "$BASH_ENV")/bin" && pwd):$PATH"\n');
    await execFileAsync(SHELL.BASH, [path.join(import.meta.dirname, "run.sh"), "test", "full"], {
      env: {
        ...process.env,
        BASH_ENV: bashEnv,
        TEST_DOCKER_LOG: dockerLog,
        TEST_NETWORK_MISSING: networkExists ? "0" : "1",
        NOOBOT_E2E_DOCKER_CONTAINER: "validation",
        NOOBOT_E2E_DOCKER_WORKSPACE: path.join(directory, "workspace"),
        NOOBOT_E2E_DOCKER_RESULTS: path.join(directory, "results"),
        NOOBOT_E2E_CONNECT_CODE: "test-credential",
        NOOBOT_E2E_MYSQL_HOST: "fixture-mysql",
        NOOBOT_E2E_MYSQL_PORT: "3307",
        NOOBOT_E2E_MYSQL_USER: "fixture-reader",
        NOOBOT_E2E_MYSQL_PASSWORD: "fixture-password",
        NOOBOT_E2E_MYSQL_DATABASE: "fixture-db",
      },
    });
    const calls = (await readFile(dockerLog, "utf8")).trim().split("\n");
    assert.ok(calls.includes("rm -f validation"));
    assert.ok(calls.includes("rm -f validation-mcp"));
    assert.ok(calls.includes("network inspect validation-network"));
    assert.equal(calls.filter((call) => call.startsWith("curl -fsS http://127.0.0.1:")).length, 1);
    assert.equal(calls.includes("network create validation-network"), !networkExists);
    assert.ok(!calls.some((call) => call.startsWith("network rm ")));
    const starts = calls.filter((call) => call.startsWith("run -d "));
    assert.equal(starts.length, 2);
    assert.ok(starts.every((call) => call.includes("--network validation-network")));
    assert.ok(starts[0].includes("--network-alias noobot-mcp-test"));
    assert.ok(starts[1].includes(`${path.join(directory, "workspace")}:`));
    assert.ok(starts[1].includes(`${path.join(directory, "results")}:`));
    const testCall = calls.find((call) => call.includes("test:e2e:protocol:full"));
    for (const field of ["HOST", "PORT", "USER", "PASSWORD", "DATABASE"]) {
      assert.ok(testCall.includes(`-e NOOBOT_E2E_MYSQL_${field}`));
    }
    assert.ok(!testCall.includes("fixture-password"));
  });
}
