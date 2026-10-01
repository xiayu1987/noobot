/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { flushJsonLineBatches } from "@noobot/runtime-events";
import { resolveConfiguredSuperUserId, SUPER_ADMIN_ROLE } from "#agent/utils";
import { createHeadlessRuntime } from "../bootstrap/create-headless-runtime.js";
import { createInProcessChatTransport } from "../bootstrap/create-in-process-chat-transport.js";
import { resolveSessionLogConfig } from "../ws/log-websocket-server.js";
import { readCliAttachments } from "./attachments.js";
import { CLI_ACTION, CLI_USAGE, CliUsageError, parseCliArgs } from "./cli-args.js";
import { promptInteraction } from "./interaction-prompt.js";
import { buildResult, createRenderer } from "./output.js";
import { buildRunCommand, CLI_EXIT_CODE, createCliTurnIdentity, runCliTurn } from "./run-turn.js";
import {
  probeRunningService,
  readAggregateVersion,
  resolveCliAuthInfo,
  resolveSessionTarget,
  splitStartupArgs,
} from "./session-context.js";

async function readStdin(stdin) {
  if (stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function listSessions({ bot, authInfo, invocation, stdout }) {
  const sessions = await bot.session.getAllSessionSummaries({ userId: authInfo.userId });
  if (invocation.outputFormat === "text") {
    for (const item of sessions) {
      stdout.write(`${item.sessionId}\t${item.updatedAt || ""}\t${item.title || ""}\n`);
    }
  } else {
    stdout.write(`${JSON.stringify({ userId: authInfo.userId, sessions })}\n`);
  }
  return CLI_EXIT_CODE.DONE;
}

async function runTurnWithRetry({ runtime, transport, authInfo, invocation, io }) {
  const bot = runtime.appDependencies.getBot();
  const renderer = createRenderer(invocation.outputFormat, io);
  const locale = invocation.preferences.locale || runtime.appDependencies.defaultLocale;
  const attachments = await readCliAttachments(invocation.files, { cwd: io.cwd });
  const message =
    invocation.message.trim() ||
    (attachments.length
      ? runtime.appDependencies.translateText("cli.attachmentOnlyMessage", locale)
      : "");
  if (!message) throw new CliUsageError("message is required (-p, positional args or stdin)");
  const resolvedInvocation = { ...invocation, message };
  const target = await resolveSessionTarget({
    bot,
    userId: authInfo.userId,
    invocation: resolvedInvocation,
  });

  if (await probeRunningService(io.env)) {
    renderer.notice(
      "a noobot service is running; it cannot stop or recover turns run by this CLI process",
    );
  }

  let aggregateVersion = target.aggregateVersion;
  let sessionId = target.sessionId;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const identity = createCliTurnIdentity({ sessionId });
    sessionId = identity.sessionId;
    const command = buildRunCommand({
      invocation: resolvedInvocation,
      identity,
      attachments,
      aggregateVersion,
      createSession: target.createSession,
    });
    const run = await runCliTurn({
      transport,
      authInfo,
      command,
      identity,
      renderer,
      allowInteraction: invocation.preferences.allowUserInteraction && io.interactive,
      askInteraction: (request) =>
        promptInteraction(request, { input: io.stdin, output: io.stderr }),
    });
    if (run.rejected && !target.createSession && attempt === 0) {
      const latest = await readAggregateVersion({ bot, userId: authInfo.userId, sessionId });
      if (latest !== aggregateVersion) {
        aggregateVersion = latest;
        renderer.notice("session changed during acceptance; retrying once");
        continue;
      }
    }
    const result = buildResult(run);
    if (invocation.outputLastMessage) {
      await writeFile(path.resolve(io.cwd, invocation.outputLastMessage), result.content);
    }
    renderer.result(result);
    return run.exitCode;
  }
  return CLI_EXIT_CODE.FAILED;
}

export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  serviceRoot = process.cwd(),
  io = {},
} = {}) {
  const streams = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    ...io,
  };
  const interactive = Boolean(streams.stdin.isTTY && streams.stderr.isTTY);
  const { startupArgs, cliArgs } = splitStartupArgs(argv);
  let invocation;
  try {
    invocation = parseCliArgs(cliArgs, { interactive });
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    streams.stderr.write(`noobot: ${error.message}\n\n${CLI_USAGE}\n`);
    return CLI_EXIT_CODE.USAGE;
  }
  if (invocation.action === CLI_ACTION.HELP) {
    streams.stdout.write(`${CLI_USAGE}\n`);
    return CLI_EXIT_CODE.DONE;
  }
  if (invocation.action !== CLI_ACTION.SESSIONS && !invocation.message.trim()) {
    invocation = { ...invocation, message: await readStdin(streams.stdin) };
  }

  const runtime = await createHeadlessRuntime({
    argv: startupArgs,
    cwd: serviceRoot,
    startupSource: "cli",
  });
  try {
    const { appDependencies, connectorAccessPort } = runtime;
    const authInfo = resolveCliAuthInfo({
      userId: invocation.userId,
      superUserId: resolveConfiguredSuperUserId(appDependencies.getGlobalConfig()),
      superAdminRole: SUPER_ADMIN_ROLE,
      isForbiddenUserScope: appDependencies.isForbiddenUserScope,
    });
    if (invocation.action === CLI_ACTION.SESSIONS) {
      return await listSessions({
        bot: appDependencies.getBot(),
        authInfo,
        invocation,
        stdout: streams.stdout,
      });
    }
    const transport = createInProcessChatTransport({
      appDependencies,
      connectorAccessPort,
      sessionLogConfig: resolveSessionLogConfig({
        workspaceRoot: appDependencies.workspaceRootPath(),
      }),
    });
    return await runTurnWithRetry({
      runtime,
      transport,
      authInfo,
      invocation,
      io: { ...streams, cwd, interactive },
    });
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    streams.stderr.write(`noobot: ${error.message}\n`);
    return CLI_EXIT_CODE.USAGE;
  } finally {
    await runtime.releaseConnectors();
    await flushJsonLineBatches();
  }
}
