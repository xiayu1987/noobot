/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { CLI_ACTION, CliUsageError, parseCliArgs } from "../../cli/cli-args.js";
import { readCliAttachments } from "../../cli/attachments.js";
import {
  normalizeAggregateVersion,
  resolveCliAuthInfo,
  resolveSessionTarget,
  splitStartupArgs,
} from "../../cli/session-context.js";

test("send maps flags onto run preferences", () => {
  const invocation = parseCliArgs(
    [
      "-p",
      "hi",
      "-m",
      "gpt",
      "--plugin",
      "a",
      "--plugin",
      "b",
      "--confirm-level",
      "high",
      "--no-safe-confirm",
    ],
    { interactive: true },
  );
  assert.equal(invocation.action, CLI_ACTION.SEND);
  assert.equal(invocation.message, "hi");
  assert.equal(invocation.preferences.selectedModel, "gpt");
  assert.deepEqual(invocation.preferences.selectedPlugins, ["a", "b"]);
  assert.equal(invocation.preferences.confirmationLevel, "high");
  assert.equal(invocation.preferences.safeConfirm, false);
  assert.equal(invocation.preferences.allowUserInteraction, true);
  assert.equal(invocation.preferences.frontendThresholdsEnabled, false);
});

test("non-TTY disables interaction unless re-enabled", () => {
  assert.equal(parseCliArgs(["x"]).preferences.allowUserInteraction, false);
  assert.equal(parseCliArgs(["--interaction", "x"]).preferences.allowUserInteraction, true);
});

test("invalid combinations are usage errors", () => {
  assert.throws(() => parseCliArgs(["-c", "-r", "s1", "x"]), CliUsageError);
  assert.throws(() => parseCliArgs(["-r", "s1", "--connector", "c", "x"]), CliUsageError);
  assert.throws(() => parseCliArgs(["-o", "yaml", "x"]), CliUsageError);
  assert.throws(() => parseCliArgs(["--confirm-level", "max", "x"]), CliUsageError);
  assert.throws(() => parseCliArgs(["continue", "--session", "s1"]), /--dialog/);
  assert.throws(() => parseCliArgs(["--bogus"]), CliUsageError);
});

test("continue subcommand carries continuation identity", () => {
  const invocation = parseCliArgs([
    "continue",
    "--session",
    "s1",
    "--dialog",
    "d1",
    "--turn",
    "t1",
    "go",
  ]);
  assert.equal(invocation.action, CLI_ACTION.CONTINUE);
  assert.equal(invocation.sessionId, "s1");
  assert.equal(invocation.dialogProcessId, "d1");
  assert.equal(invocation.turnScopeId, "t1");
  assert.equal(invocation.message, "go");
});

test("startup-context args are split in both forms", () => {
  assert.deepEqual(splitStartupArgs(["--startup-context", "/a.json", "-p", "x"]), {
    startupArgs: ["--startup-context", "/a.json"],
    cliArgs: ["-p", "x"],
  });
  assert.deepEqual(splitStartupArgs(["--startup-context=/a.json", "x"]), {
    startupArgs: ["--startup-context=/a.json"],
    cliArgs: ["x"],
  });
});

test("aggregate version is normalized to a non-negative integer", () => {
  assert.equal(normalizeAggregateVersion(undefined), 0);
  assert.equal(normalizeAggregateVersion(3), 3);
  assert.equal(normalizeAggregateVersion(-1), 0);
  assert.equal(normalizeAggregateVersion("x"), 0);
});

test("auth defaults to configured super admin; --user runs as that user", () => {
  const base = {
    superUserId: "admin",
    superAdminRole: "super_admin",
    isForbiddenUserScope: () => false,
  };
  assert.deepEqual(resolveCliAuthInfo({ ...base, userId: "" }), {
    userId: "admin",
    role: "super_admin",
  });
  assert.deepEqual(resolveCliAuthInfo({ ...base, userId: "alice" }), {
    userId: "alice",
    role: "user",
  });
  assert.throws(() => resolveCliAuthInfo({ ...base, superUserId: "" }), CliUsageError);
  assert.throws(
    () => resolveCliAuthInfo({ ...base, userId: "bob", isForbiddenUserScope: () => true }),
    /forbidden/,
  );
});

test("session target: new, -c latest, -r existing", async () => {
  const bot = {
    session: {
      getAllSessionSummaries: async () => [{ sessionId: "s2", aggregateVersion: 7 }],
      getSessionDisplayData: async () => ({ sessions: [{ sessionId: "s1", aggregateVersion: 4 }] }),
    },
  };
  assert.deepEqual(await resolveSessionTarget({ bot, userId: "u", invocation: {} }), {
    sessionId: "",
    aggregateVersion: 0,
    createSession: true,
  });
  assert.deepEqual(
    await resolveSessionTarget({ bot, userId: "u", invocation: { continueLatest: true } }),
    { sessionId: "s2", aggregateVersion: 7, createSession: false },
  );
  assert.deepEqual(
    await resolveSessionTarget({ bot, userId: "u", invocation: { sessionId: "s1" } }),
    { sessionId: "s1", aggregateVersion: 4, createSession: false },
  );
  await assert.rejects(
    resolveSessionTarget({ bot, userId: "u", invocation: { sessionId: "missing" } }),
    /session not found/,
  );
});

test("attachments are serialized and size-checked against shared thresholds", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "noobot-cli-att-"));
  try {
    await writeFile(path.join(dir, "a.txt"), "hello");
    const [item] = await readCliAttachments(["a.txt"], { cwd: dir });
    assert.equal(item.name, "a.txt");
    assert.equal(Buffer.from(item.contentBase64, "base64").toString(), "hello");
    await assert.rejects(readCliAttachments(["nope.txt"], { cwd: dir }), /not found/);
    const big = path.join(dir, "big.bin");
    await writeFile(big, Buffer.alloc(LENGTH_THRESHOLDS.attachments.maxFileSizeBytes + 1));
    await assert.rejects(readCliAttachments([big]), /exceeds/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
