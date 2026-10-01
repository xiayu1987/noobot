/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { CliUsageError } from "./cli-args.js";

const STARTUP_CONTEXT_ARG = "--startup-context";

export function splitStartupArgs(argv = []) {
  const startupArgs = [];
  const cliArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] ?? "");
    if (item === STARTUP_CONTEXT_ARG) {
      startupArgs.push(item, String(argv[index + 1] ?? ""));
      index += 1;
    } else if (item.startsWith(`${STARTUP_CONTEXT_ARG}=`)) {
      startupArgs.push(item);
    } else {
      cliArgs.push(item);
    }
  }
  return { startupArgs, cliArgs };
}

export function normalizeAggregateVersion(value) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function resolveCliAuthInfo({ userId, superUserId, superAdminRole, isForbiddenUserScope }) {
  const admin = { userId: superUserId, role: superAdminRole };
  if (!superUserId) throw new CliUsageError("no super admin user is configured");
  if (!userId || userId === superUserId) return admin;
  if (isForbiddenUserScope(admin, userId))
    throw new CliUsageError(`user scope forbidden: ${userId}`);
  return { userId, role: "user" };
}

export async function resolveSessionTarget({ bot, userId, invocation }) {
  if (invocation.continueLatest) {
    const [latest] = await bot.session.getAllSessionSummaries({ userId });
    if (!latest?.sessionId) throw new CliUsageError("no session to continue");
    return {
      sessionId: latest.sessionId,
      aggregateVersion: normalizeAggregateVersion(latest.aggregateVersion),
      createSession: false,
    };
  }
  if (!invocation.sessionId) return { sessionId: "", aggregateVersion: 0, createSession: true };
  return {
    sessionId: invocation.sessionId,
    aggregateVersion: await readAggregateVersion({ bot, userId, sessionId: invocation.sessionId }),
    createSession: false,
  };
}

export async function readAggregateVersion({ bot, userId, sessionId }) {
  const result = await bot.session.getSessionDisplayData({ userId, sessionId });
  const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
  const session = sessions.find((item) => String(item?.sessionId || "") === sessionId);
  if (!session) throw new CliUsageError(`session not found: ${sessionId}`);
  return normalizeAggregateVersion(session.aggregateVersion);
}

export async function probeRunningService(env = process.env) {
  const { agentProxyUpstreamHttpBase } = resolveRuntimeTopology(env);
  try {
    const response = await fetch(`${agentProxyUpstreamHttpBase}/health`, {
      signal: AbortSignal.timeout(TIME_THRESHOLDS.cli.healthProbeMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
