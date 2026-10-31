/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CHECK, measureDeadCodeReport, scanDeadCode } from "./check-dead-code.mjs";
import { createExemptionUsage, evaluateCheck } from "./quality/check-protocol.mjs";
import { createDeadCodeConfig } from "./quality/dead-code-config.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "noobot-dead-code-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, typeof source === "string" ? source : JSON.stringify(source));
  }
  return root;
}

function row(file, issues) {
  return {
    file,
    files: [],
    exports: [],
    nsExports: [],
    dependencies: [],
    devDependencies: [],
    optionalPeerDependencies: [],
    ...issues,
  };
}

test("real scanner detects orphan modules, dead cycles, unused exports and dependencies", (t) => {
  const root = fixture(t, {
    "package.json": {
      name: "dead-code-fixture",
      type: "module",
      dependencies: { unused: "1.0.0" },
    },
    "knip.json": {
      entry: ["src/main.js"],
      project: ["src/**/*.js"],
      include: ["files", "exports", "nsExports", "dependencies"],
    },
    "src/main.js": 'import { live } from "./library.js";\nlive();\nimport("./lazy.js");\n',
    "src/library.js": "export function live() {}\nexport function dead() {}\n",
    "src/lazy.js": 'process.stdout.write("lazy");\n',
    "src/orphan.js": "export const orphan = true;\n",
    "src/cycle-a.js": 'import "./cycle-b.js";\n',
    "src/cycle-b.js": 'import "./cycle-a.js";\n',
  });
  const measured = measureDeadCodeReport(scanDeadCode(root, "knip.json"));
  assert.equal(measured.unusedFiles.total, 3);
  assert.equal(measured.unusedExports.total, 1);
  assert.match(measured.unusedExports.samples[0], /library.js.*dead/);
  assert.equal(measured.unusedDependencies.total, 1);
  assert.match(measured.unusedDependencies.samples[0], /unused/);
});

test("invalid scanner configuration fails instead of reporting a clean scan", (t) => {
  const root = fixture(t, { "package.json": { name: "invalid-config" }, "knip.json": "{" });
  assert.throws(() => scanDeadCode(root, "knip.json"), /Knip/);
  assert.throws(() => measureDeadCodeReport({}), /must contain issues/);
});

test("production report excludes test and generated files and scopes dynamic driver exemptions", () => {
  const usage = createExemptionUsage(CHECK);
  const measured = measureDeadCodeReport(
    {
      issues: [
        row("agent/__tests__/fixture.js", { files: [{ name: "fixture" }] }),
        row("agent/src/generated/fixture.js", { exports: [{ name: "generated" }] }),
        row("connector-instances/package.json", {
          dependencies: ["mysql2", "pg", "ssh2"].map((name) => ({ name })),
        }),
        row("agent/package.json", { dependencies: [{ name: "pg" }] }),
        row("agent/src/live.js", { nsExports: [{ name: "deadMember", line: 2 }] }),
      ],
    },
    usage,
  );
  assert.equal(measured.unusedFiles.total, 0);
  assert.equal(measured.unusedExports.total, 1);
  assert.equal(measured.unusedDependencies.total, 1);
  assert.deepEqual(usage.staleEntries(), []);
});

test("dead-code check rejects increases and requires baseline tightening after cleanup", () => {
  const measured = Object.fromEntries(
    Object.keys(CHECK.rules).map((rule) => [
      rule,
      { total: CHECK.baseline[rule], files: {}, samples: [] },
    ]),
  );
  const usage = { staleEntries: () => [] };
  measured.unusedFiles.total += 1;
  assert.ok(
    evaluateCheck(CHECK, measured, usage).increases.some((line) => line.includes("unusedFiles")),
  );
  measured.unusedFiles.total = CHECK.baseline.unusedFiles;
  measured.unusedExports.total -= 1;
  assert.ok(
    evaluateCheck(CHECK, measured, usage).decreases.some((line) => line.includes("unusedExports")),
  );
});

test("scanner uses the shared inventory and manifest and packaging runtime entries", async () => {
  const config = await createDeadCodeConfig(repositoryRoot);
  const actualFiles = Object.entries(config.workspaces)
    .flatMap(([directory, workspace]) =>
      workspace.project.map((file) => (directory === "." ? file : `${directory}/${file}`)),
    )
    .sort();
  assert.deepEqual(
    actualFiles,
    await getFirstPartyCodeFiles({ repositoryRoot, includeTests: true }),
  );
  assert.ok(
    config.workspaces["plugin/noobot-plugin-harness"].entry.includes("src/entries/agent.js"),
  );
  assert.ok(
    config.workspaces["plugin/noobot-plugin-harness"].entry.includes(
      "./frontend/components/HarnessModelExtension.vue",
    ),
  );
  assert.ok(
    config.workspaces["client/windows"].entry.includes("scripts/copy-backend-after-pack.js"),
  );
  assert.ok(config.workspaces["client/shared"].entry.includes("electron/preload.cjs"));
});
