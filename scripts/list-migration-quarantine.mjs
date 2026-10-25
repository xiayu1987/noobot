#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  resolveConfiguredWorkspaceRoot,
  resolveGlobalConfigPath,
} from "@noobot/runtime-topology-protocol/workspace-root";
import {
  listQuarantinedUnits,
  listWorkspaceBackups,
} from "../agent/src/workspace-lifecycle/migration-quarantine.js";
import { resolveConfiguredSuperUserId } from "../agent/src/shared/utils/super-user.js";
import { createWorkspaceUsersService } from "../service/services/workspace-users-service.js";

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function listUserBases(workspaceRoot, globalConfig) {
  const { readWorkspaceUsers } = createWorkspaceUsersService({
    workspaceRootPath: () => workspaceRoot,
  });
  const userIds = [
    ...new Set(
      [
        ...(await readWorkspaceUsers()).map((user) => user.userId),
        resolveConfiguredSuperUserId(globalConfig),
      ].filter(Boolean),
    ),
  ].sort();
  const bases = [];
  for (const userId of userIds) {
    const base = path.join(workspaceRoot, userId);
    if (await isDirectory(base)) bases.push({ userId, base });
  }
  return bases;
}

export async function collectMigrationQuarantine(workspaceRoot, globalConfig) {
  const users = [];
  for (const { userId, base } of await listUserBases(workspaceRoot, globalConfig)) {
    const units = await listQuarantinedUnits({ base });
    if (!units.length) continue;
    users.push({ userId, base, units, backups: await listWorkspaceBackups({ base }) });
  }
  return users;
}

function printReport(workspaceRoot, users) {
  const lines = [`workspace: ${workspaceRoot}`];
  if (!users.length) lines.push("no quarantined units");
  for (const { userId, base, units, backups } of users) {
    lines.push("", `[${userId}] ${base} (${units.length} quarantined)`);
    for (const unit of units) {
      lines.push(
        `  - ${unit.kind} ${unit.path}`,
        `    error: ${unit.error.code || "-"} ${unit.error.message}`,
        `    held: ${unit.quarantinePath} (moved=${unit.moved}) at ${unit.quarantinedAt}`,
      );
    }
    lines.push(`  backups (match by time): ${backups.length ? "" : "none"}`);
    for (const backup of backups) lines.push(`    ${backup}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const [rootArg = process.cwd(), ...flags] = process.argv.slice(2);
  const serviceDir = path.join(path.resolve(rootArg), "service");
  const globalConfigPath = resolveGlobalConfigPath({ serviceDir, env: process.env });
  const workspaceRoot = resolveConfiguredWorkspaceRoot({ globalConfigPath, serviceDir });
  const globalConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
  const users = await collectMigrationQuarantine(workspaceRoot, globalConfig);
  if (flags.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ workspaceRoot, users }, null, 2)}\n`);
  } else {
    printReport(workspaceRoot, users);
  }
}
