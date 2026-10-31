/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { SESSION_ARTIFACT_FILE_NAMES } from "../src/session/session-artifact-files.js";
import { upgradeSessionDirectories } from "../src/workspace-lifecycle/session-upgrade-driver.js";

const ROOT = path.join("runtime", "session");
const KIND = "driver-test";
const QUARANTINE_CODE = "DRIVER_TEST_INVALID";

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function withSessions(names, run) {
  const base = await mkdtemp(path.join(os.tmpdir(), "noobot-upgrade-driver-"));
  try {
    for (const name of names) {
      const sessionDir = path.join(base, ROOT, name);
      await mkdir(sessionDir, { recursive: true });
      await writeFile(path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.session), "{}\n");
    }
    await run(base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function driverInput(base, overrides) {
  return {
    base,
    roots: [ROOT],
    kind: KIND,
    quarantineCode: QUARANTINE_CODE,
    normalizeError: (error) => error,
    onSessionProcessed: () => {},
    ...overrides,
  };
}

test("quarantines sessions failing with the quarantine code and continues", async () => {
  await withSessions(["a", "b"], async (base) => {
    const processed = [];
    const result = await upgradeSessionDirectories(
      driverInput(base, {
        upgrade: async ({ sessionDir }) => {
          if (path.basename(sessionDir) === "a") throw codedError(QUARANTINE_CODE);
          return { sessionDir: path.relative(base, sessionDir) };
        },
        onSessionProcessed: () => processed.push(true),
      }),
    );
    assert.deepEqual(result.sessions, [{ sessionDir: path.join(ROOT, "b") }]);
    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].path, path.join(ROOT, "a"));
    assert.equal(result.quarantined[0].error.code, QUARANTINE_CODE);
    const reasonPath = path.join(base, result.quarantined[0].quarantinePath);
    assert.ok(reasonPath.startsWith(path.join(base, WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR)));
    assert.equal(JSON.parse(await readFile(reasonPath, "utf8")).kind, KIND);
    assert.equal(processed.length, 2);
  });
});

test("rethrows other errors and stops processing further sessions", async () => {
  await withSessions(["a", "b"], async (base) => {
    const visited = [];
    await assert.rejects(
      upgradeSessionDirectories(
        driverInput(base, {
          upgrade: async ({ sessionDir }) => {
            visited.push(path.basename(sessionDir));
            throw codedError("UNEXPECTED");
          },
        }),
      ),
      { code: "UNEXPECTED" },
    );
    assert.equal(visited.length, 1);
  });
});

test("classifies by the normalized error and quarantines the normalized form", async () => {
  await withSessions(["a"], async (base) => {
    const seen = [];
    const result = await upgradeSessionDirectories(
      driverInput(base, {
        upgrade: async () => {
          throw codedError("RAW_DATA_REJECTION");
        },
        normalizeError: (error, relativePath) => {
          seen.push(relativePath);
          return codedError(QUARANTINE_CODE, `${error.code} at ${relativePath}`);
        },
      }),
    );
    assert.deepEqual(seen, [path.join(ROOT, "a")]);
    assert.equal(result.quarantined[0].error.code, QUARANTINE_CODE);
    assert.equal(result.quarantined[0].error.message, `RAW_DATA_REJECTION at ${seen[0]}`);
  });
});

test("rejects a missing quarantine contract", async () => {
  await withSessions([], async (base) => {
    const upgrade = async () => null;
    await assert.rejects(
      upgradeSessionDirectories(driverInput(base, { upgrade, quarantineCode: undefined })),
      { name: "TypeError", message: /quarantineCode/u },
    );
    await assert.rejects(
      upgradeSessionDirectories(driverInput(base, { upgrade, normalizeError: undefined })),
      { name: "TypeError", message: /normalizeError/u },
    );
  });
});
