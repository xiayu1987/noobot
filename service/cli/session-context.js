/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimeTopology } from "@noobot/runtime-topology-protocol/ports";
import {
  isAvailableSessionDetailEntry,
  requireSessionDetailDocument,
  selectMainSessionDetailEntry,
} from "@noobot/session-protocol/session-detail";
import {
  SESSION_SUMMARY_AVAILABILITY,
  compareSessionSummaries,
} from "@noobot/session-protocol/sessions-summary";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { randomUUID } from "node:crypto";
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

export function resolveCliAuthInfo({ userId, superUserId, superAdminRole }) {
  const admin = { userId: superUserId, role: superAdminRole };
  if (!superUserId) throw new CliUsageError("no super admin user is configured");
  if (!userId || userId === superUserId) return admin;
  return { userId, role: "user" };
}

export async function resolveSessionTarget({ bot, userId, invocation }) {
  if (invocation.continueLatest) {
    const payload = await bot.session.getAllSessionSummaries({ userId });
    const [latest] = [...payload.sessions].sort(compareSessionSummaries);
    if (latest === undefined) throw new CliUsageError("no session to continue");
    if (latest.availability !== SESSION_SUMMARY_AVAILABILITY.AVAILABLE) {
      throw new CliUsageError(
        `latest session unavailable: ${latest.sessionId} (${latest.unavailableReason.code})`,
      );
    }
    return {
      sessionId: latest.sessionId,
      aggregateVersion: latest.aggregateVersion,
      createSession: false,
    };
  }
  if (!invocation.sessionId) {
    return { sessionId: randomUUID(), aggregateVersion: 0, createSession: true };
  }
  return {
    sessionId: invocation.sessionId,
    aggregateVersion: await readAggregateVersion({ bot, userId, sessionId: invocation.sessionId }),
    createSession: false,
  };
}

export async function readAggregateVersion({ bot, userId, sessionId }) {
  const document = requireSessionDetailDocument(
    await bot.session.getSessionDisplayData({ userId, sessionId }),
  );
  if (!document.exists) throw new CliUsageError(`session not found: ${sessionId}`);
  const entry = selectMainSessionDetailEntry(document);
  if (!isAvailableSessionDetailEntry(entry)) {
    throw new CliUsageError(`session unavailable: ${sessionId} (${entry.unavailableReason.code})`);
  }
  return entry.aggregateVersion;
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
