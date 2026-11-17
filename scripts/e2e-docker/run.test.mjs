/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("full E2E declares the complete non-performance project without grep filters", async () => {
  const clientRoot = path.resolve(import.meta.dirname, "../../client/noobot-chat");
  const { stdout } = await execFileAsync(
    "npm",
    ["run", "--silent", "test:e2e:protocol:full", "--", "--list", "--reporter=json"],
    { cwd: clientRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.config.projects.map((project) => project.name),
    ["chromium-protocol"],
  );
  const [project] = report.config.projects;
  assert.ok(!report.config.argv.some((argument) => argument.startsWith("--grep")));
  assert.equal(report.config.grepInvert, null);
  const ignored = project.testIgnore.map((pattern) => new RegExp(pattern.slice(1, -1)));
  const expectedFiles = (await readdir(path.join(clientRoot, "tests/e2e/protocol/specs")))
    .filter((file) => file.endsWith(".spec.js") && !ignored.some((pattern) => pattern.test(file)))
    .sort();
  assert.ok(expectedFiles.length > 0);
  assert.deepEqual(report.suites.map((suite) => path.basename(suite.file)).sort(), expectedFiles);
});

for (const networkExists of [true, false]) {
  test(`Docker restart preserves shared dependencies (network exists: ${networkExists})`, async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "noobot-e2e-lifecycle-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const bin = path.join(directory, "bin");
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
    case "$3" in noobot-e2e|noobot-mcp-test|noobot-mock-model) ;; *) exit 98 ;; esac ;;
esac
`,
      node: `#!/bin/sh
case "$1" in */prepare-workspace.mjs) exit 0 ;; esac
exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"
`,
      npm: "#!/bin/sh\nexit 0\n",
      curl: "#!/bin/sh\nexit 0\n",
    };
    for (const [name, content] of Object.entries(commands)) {
      await writeFile(path.join(bin, name), content, { mode: 0o755 });
    }
    await execFileAsync("bash", [path.join(import.meta.dirname, "run.sh"), "restart"], {
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TEST_DOCKER_LOG: dockerLog,
        TEST_NETWORK_MISSING: networkExists ? "0" : "1",
      },
    });
    const calls = (await readFile(dockerLog, "utf8")).trim().split("\n");
    assert.ok(calls.includes("rm -f noobot-e2e"));
    assert.ok(calls.includes("rm -f noobot-mcp-test"));
    assert.ok(calls.includes("network inspect noobot-e2e-network"));
    assert.equal(calls.includes("network create noobot-e2e-network"), !networkExists);
    assert.ok(!calls.some((call) => call.startsWith("network rm ")));
    const starts = calls.filter((call) => call.startsWith("run -d "));
    assert.equal(starts.length, 2);
    assert.ok(starts.every((call) => call.includes("--network noobot-e2e-network")));
  });
}
