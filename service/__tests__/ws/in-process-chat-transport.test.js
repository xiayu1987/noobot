/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  createInProcessChatTransport,
  resolveInProcessExitCode,
} from "../../bootstrap/create-in-process-chat-transport.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import { createChatRunService } from "../../services/chat-run-service.js";
import {
  createProtocolTestCommand,
  withTestBotAuthorities,
} from "../routes/chat-websocket-server.test-helpers.js";
import {
  createAuthoritativeBot,
  payload,
} from "../routes/chat-websocket-server.turn-lifecycle.fixtures.js";

function createTransport() {
  return createInProcessChatTransport({
    appDependencies: {
      getBot: () => ({}),
      normalizeLocale: (value) => String(value || "en-US"),
      defaultLocale: "en-US",
      translateText: (key) => key,
      mapAgentRunCommand: (command) => command,
    },
    connectorAccessPort: {},
    sessionLogConfig: { workspaceRoot: path.join(os.tmpdir(), "noobot-in-process-transport") },
  });
}

test("terminal close reasons map to CLI exit codes", () => {
  assert.equal(resolveInProcessExitCode("done"), 0);
  assert.equal(resolveInProcessExitCode("user_stopped"), 130);
  assert.equal(resolveInProcessExitCode("timeout"), 1);
  assert.equal(resolveInProcessExitCode("aborted"), 1);
  assert.equal(resolveInProcessExitCode("error"), 1);
  assert.equal(resolveInProcessExitCode("invalid request"), 2);
  assert.equal(resolveInProcessExitCode("client closed"), 1);
});

test("in-process connection requires an authenticated owner", () => {
  const transport = createTransport();
  assert.throws(() => transport.openConnection({}), /authInfo\.userId/);
  assert.throws(() => transport.openConnection({ authInfo: { userId: " " } }), /authInfo\.userId/);
});

test("invalid command goes through the shared connection handler and closes with exit code 2", async () => {
  const connection = createTransport().openConnection({
    authInfo: { userId: "cli-user", role: "super_admin" },
  });
  assert.equal(connection.isOpen(), true);
  connection.send({ commandType: "not-a-command" });
  const outcome = await connection.closed;
  assert.equal(outcome.code, 1008);
  assert.equal(outcome.reason, "invalid request");
  assert.equal(outcome.exitCode, 2);
  assert.equal(connection.isOpen(), false);
  assert.throws(() => connection.send({}), /closed/);
});

test("client close resolves once and is idempotent", async () => {
  const connection = createTransport().openConnection({ authInfo: { userId: "cli-user" } });
  connection.close();
  connection.close();
  const outcome = await connection.closed;
  assert.equal(outcome.code, 1000);
  assert.equal(outcome.reason, "client closed");
});

test("in-process close aborts the running turn and releases the session", async () => {
  const authoritative = createAuthoritativeBot();
  let aborted = false;
  authoritative.bot.runSession = async ({ sessionId, runConfig, abortSignal, eventListener }) => {
    eventListener.onEvent({
      event: "agent_lifecycle_state_changed",
      data: {
        state: "running",
        sessionId,
        turnScopeId: runConfig.turnScopeId,
        dialogProcessId: "dp-in-process-abort",
      },
    });
    await new Promise((_resolve, reject) => {
      abortSignal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(abortSignal.reason || new Error("aborted"));
        },
        { once: true },
      );
    });
  };
  const bot = withTestBotAuthorities(authoritative.bot);
  const { mapAgentRunCommand } = createChatRunService({
    getBot: () => bot,
    normalizeLocale: (locale = "") => String(locale || "en-US"),
    defaultLocale: "en-US",
    translateText: (key = "") => String(key || ""),
  });
  const transport = createInProcessChatTransport({
    appDependencies: {
      getBot: () => bot,
      normalizeLocale: (value) => String(value || "en-US"),
      defaultLocale: "en-US",
      translateText: (key) => key,
      mapAgentRunCommand,
    },
    connectorAccessPort: {},
    sessionLogConfig: { workspaceRoot: path.join(os.tmpdir(), "noobot-in-process-transport") },
  });
  const scopedPayload = {
    ...payload,
    sessionId: "s-in-process-abort",
    turnScopeId: "turn-in-process-abort",
    commandId: "command-in-process-abort",
    config: { turnScopeId: "turn-in-process-abort" },
  };
  let resolveStarted = null;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  const connection = transport.openConnection({
    authInfo: { userId: "primary-user" },
    onEvent: (message) => {
      if (message?.data?.payload?.eventType === TURN_EVENT.PROCESSING_STARTED) resolveStarted();
    },
  });
  connection.send(createProtocolTestCommand(scopedPayload));
  await Promise.race([
    started,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("processing_started not observed")), 2000);
    }),
  ]);
  connection.close();
  const deadline = Date.now() + 1000;
  while (authoritative.lifecycle().activeTurnScopeId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(aborted, true);
  assert.deepEqual(authoritative.committed(), [
    TURN_EVENT.ACTION_ACCEPTED,
    TURN_EVENT.PROCESSING_STARTED,
    TURN_EVENT.FAILED,
  ]);
  assert.equal(authoritative.lifecycle().activeTurnScopeId, "");
});
