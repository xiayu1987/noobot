/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export function createWorkspaceUsersService({
  workspaceRootPath,
  defaultWorkspaceUsersConfig = { users: [] },
} = {}) {
  function normalizeWorkspaceUsersConfig(input) {
    const sourceItems = Array.isArray(input)
      ? input
      : Array.isArray(input?.users)
        ? input.users
        : [];
    const users = sourceItems
      .map((userItem) => ({
        userId: String(userItem?.userId || "").trim(),
        connectCode: String(userItem?.connectCode || userItem?.code || "").trim(),
      }))
      .filter((userItem) => userItem.userId && userItem.connectCode);
    return { users };
  }

  function workspaceUsersFilePath() {
    return path.join(workspaceRootPath(), "user.json");
  }

  async function readWorkspaceUsersConfig({ createIfMissing = false } = {}) {
    const filePath = workspaceUsersFilePath();
    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      if (createIfMissing) {
        const payload = normalizeWorkspaceUsersConfig(defaultWorkspaceUsersConfig);
        await writeWorkspaceUsersConfig(payload);
        return payload;
      }
      return normalizeWorkspaceUsersConfig([]);
    }
    return normalizeWorkspaceUsersConfig(parsedPayload);
  }

  async function writeWorkspaceUsersConfig(configPayload = {}) {
    const filePath = workspaceUsersFilePath();
    const payload = normalizeWorkspaceUsersConfig(configPayload);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async function readWorkspaceUsers() {
    const usersConfig = await readWorkspaceUsersConfig();
    const sourceItems = Array.isArray(usersConfig?.users) ? usersConfig.users : [];
    return sourceItems
      .map((userItem) => ({
        userId: String(userItem?.userId || "").trim(),
        connectCode: String(userItem?.connectCode || userItem?.code || "").trim(),
      }))
      .filter((userItem) => userItem.userId && userItem.connectCode);
  }

  return {
    normalizeWorkspaceUsersConfig,
    readWorkspaceUsersConfig,
    writeWorkspaceUsersConfig,
    readWorkspaceUsers,
  };
}
