#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  WORKSPACE_ROOT_ENV,
  resolveConfiguredWorkspaceRoot,
  resolveGlobalConfigPath,
} from "@noobot/runtime-topology-protocol/workspace-root";
import {
  SERVICE_STARTUP_LIVENESS,
  SERVICE_STARTUP_PROGRESS_STAGES,
  SERVICE_STARTUP_STATES,
  assessServiceStartupLiveness,
  readServiceStartupState,
  resolveServiceStartupStallTimeoutMs,
} from "@noobot/runtime-events";

const SERVICE_APP_NAME = "noobot-service";
const NO_BASELINE = "-";
const PM2_FAILED_STATUSES = new Set(["errored", "stopped"]);
const RUNTIME_READINESS_EXIT_CODES = Object.freeze({
  [SERVICE_STARTUP_STATES.READY]: 0,
  [SERVICE_STARTUP_STATES.FAILED]: 1,
  [SERVICE_STARTUP_STATES.PENDING]: 2,
});

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function report(state, baseline, detail) {
  process.stdout.write(`${state} ${baseline} ${detail}\n`);
  process.exit(RUNTIME_READINESS_EXIT_CODES[state]);
}

function onlinePid(app) {
  const pid = Number(app?.pid);
  return app?.pm2_env?.status === "online" && Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

function parseBaseline(value) {
  if (value === NO_BASELINE) return null;
  return new Map(
    value.split(",").map((entry) => {
      const [name, pid] = entry.split(":");
      return [name, Number(pid)];
    }),
  );
}

function describeProgress(progress) {
  const user = `user ${progress.userIndex}/${progress.userCount}`;
  if (progress.stage === SERVICE_STARTUP_PROGRESS_STAGES.DISPLAY_SUMMARY) {
    return `upgrading: ${user} · session summaries ${progress.sessionIndex}/${progress.sessionCount}`;
  }
  return (
    `upgrading: ${user} · layout ${progress.upgradeIndex}/${progress.upgradeCount} ` +
    `(${progress.upgradeId}) · ${progress.processedSessions} sessions processed`
  );
}

const [rootArg, baselineArg, ...appNames] = process.argv.slice(2);
const serviceDir = path.join(path.resolve(rootArg), "service");
process.env[WORKSPACE_ROOT_ENV] = resolveConfiguredWorkspaceRoot({
  globalConfigPath: resolveGlobalConfigPath({ serviceDir, env: process.env }),
  serviceDir,
});

const apps = JSON.parse(await readStdin());
const appsByName = new Map(appNames.map((name) => [name, apps.find((app) => app.name === name)]));
for (const [name, app] of appsByName) {
  if (PM2_FAILED_STATUSES.has(app?.pm2_env?.status)) {
    report(SERVICE_STARTUP_STATES.FAILED, baselineArg, `${name}:${app.pm2_env.status}`);
  }
  if (Number(app?.pm2_env?.restart_time) > 0) {
    report(SERVICE_STARTUP_STATES.FAILED, baselineArg, `${name}:restarted`);
  }
}
const pids = new Map([...appsByName].map(([name, app]) => [name, onlinePid(app)]));
const pinned = parseBaseline(baselineArg);
if (pinned) {
  for (const [name, pid] of pinned) {
    if (pids.get(name) !== pid) {
      report(SERVICE_STARTUP_STATES.FAILED, baselineArg, `${name}:restarted-or-exited`);
    }
  }
} else if ([...pids.values()].some((pid) => pid === 0)) {
  report(SERVICE_STARTUP_STATES.PENDING, NO_BASELINE, "apps-not-online");
}
const baseline = pinned ? baselineArg : [...pids].map(([name, pid]) => `${name}:${pid}`).join(",");
const startup = await readServiceStartupState({
  pid: pids.get(SERVICE_APP_NAME),
});
if (startup.state !== SERVICE_STARTUP_STATES.PENDING)
  report(startup.state, baseline, startup.event);
const pendingDetail = startup.progress
  ? describeProgress(startup.progress)
  : "service-startup-pending";
const { liveness, idleMs } = assessServiceStartupLiveness(startup, {
  stallTimeoutMs: resolveServiceStartupStallTimeoutMs(),
});
if (liveness === SERVICE_STARTUP_LIVENESS.UNRESPONSIVE) {
  report(
    SERVICE_STARTUP_STATES.FAILED,
    baseline,
    `service-unresponsive:no-heartbeat-${Math.round(idleMs / 1000)}s`,
  );
}
if (liveness === SERVICE_STARTUP_LIVENESS.STALLED) {
  const idleMinutes = Math.floor(idleMs / 60000);
  report(
    startup.state,
    baseline,
    `${pendingDetail} · WARNING no progress for ${idleMinutes}+ min (possibly stalled; check pm2 logs)`,
  );
}
report(startup.state, baseline, pendingDetail);
