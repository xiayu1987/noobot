#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeKnownConfigKeys } from "@noobot/agent-config-protocol";
import { resolveConfiguredSuperUserId } from "noobot-agent/utils/super-user";
import {
  WORKSPACE_ROOT_LAYOUT,
  WORKSPACE_USER_CONFIGURATION_ENTRIES,
  isWorkspacePathSegment,
} from "../../workspace-protocol/src/layout.js";

function requireAbsoluteDir(value, label) {
  const dir = String(value || "").trim();
  if (!path.isAbsolute(dir)) throw new Error(`${label} must be an absolute path`);
  return dir;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyEntry(sourceRoot, targetRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  if (!(await exists(source))) return false;
  await cp(source, path.join(targetRoot, relativePath), { recursive: true });
  return true;
}

function requireUserId(value) {
  const userId = String(value || "").trim();
  if (!isWorkspacePathSegment(userId)) throw new Error(`invalid workspace userId: ${userId}`);
  return userId;
}

async function readWorkspaceUserIds(sourceRoot, globalConfigPath) {
  const usersFile = path.join(sourceRoot, WORKSPACE_ROOT_LAYOUT.USERS_FILE);
  const document = JSON.parse(await readFile(usersFile, "utf8"));
  const users = Array.isArray(document?.users) ? document.users : [];
  const globalConfig = normalizeKnownConfigKeys(
    JSON.parse(await readFile(globalConfigPath, "utf8")),
  );
  const superUserId = resolveConfiguredSuperUserId(globalConfig);
  const userIds = users.map((user) => requireUserId(user?.userId));
  if (superUserId) userIds.push(requireUserId(superUserId));
  return [...new Set(userIds)];
}

export async function prepareE2eWorkspace({ sourceRoot, targetRoot, globalConfigPath }) {
  const source = requireAbsoluteDir(sourceRoot, "source workspace");
  const target = requireAbsoluteDir(targetRoot, "e2e workspace");
  const configPath = requireAbsoluteDir(globalConfigPath, "global config path");
  if (source === target) throw new Error("e2e workspace must differ from the source workspace");
  const userIds = await readWorkspaceUserIds(source, configPath);
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(target)) {
    await rm(path.join(target, entry), { recursive: true, force: true });
  }
  const copied = [];
  for (const file of Object.values(WORKSPACE_ROOT_LAYOUT)) {
    if (await copyEntry(source, target, file)) copied.push(file);
  }
  for (const userId of userIds) {
    await mkdir(path.join(target, userId), { recursive: true });
    for (const entry of WORKSPACE_USER_CONFIGURATION_ENTRIES) {
      const relative = path.join(userId, entry);
      if (await copyEntry(source, target, relative)) copied.push(relative);
    }
  }
  return { userIds, copied };
}

const [sourceRoot, targetRoot, globalConfigPath] = process.argv.slice(2);
const result = await prepareE2eWorkspace({ sourceRoot, targetRoot, globalConfigPath });
console.log(
  `[e2e-docker] workspace prepared: users=${result.userIds.join(",")} entries=${result.copied.length}`,
);
