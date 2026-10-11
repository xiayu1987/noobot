/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import { WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";

export function createWorkspaceUsersService({ workspaceRootPath, runtimeEventsConfig } = {}) {
  function normalizeWorkspaceUsersConfig(input) {
    const sourceItems = Array.isArray(input)
      ? input
      : Array.isArray(input?.users)
        ? input.users
        : [];
    const users = sourceItems
      .map((userItem) => ({
        userId: String(userItem?.userId || "").trim(),
        connectCode: String(userItem?.connectCode || "").trim(),
        allowIDE: userItem?.allowIDE === true,
      }))
      .filter((userItem) => userItem.userId && userItem.connectCode);
    return { users };
  }

  function workspaceUsersFilePath() {
    return path.join(workspaceRootPath(), WORKSPACE_ROOT_LAYOUT.USERS_FILE);
  }

  async function readWorkspaceUsersConfig() {
    const filePath = workspaceUsersFilePath();
    let fileText;
    try {
      fileText = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeWorkspaceUsersConfig([]);
      throw reportReadFailure(filePath, error);
    }
    try {
      return normalizeWorkspaceUsersConfig(JSON.parse(fileText));
    } catch (error) {
      throw reportReadFailure(filePath, error);
    }
  }

  function reportReadFailure(filePath, error) {
    void writeRoutedRuntimeEvent(
      {
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.CONFIG,
        level: "error",
        event: "service.workspaceUsers.config.read.failed",
        data: {
          fileName: path.basename(filePath),
          filePathLength: String(filePath || "").length,
        },
        error,
      },
      runtimeEventsConfig,
    );
    return new Error(`workspace users config is unreadable: ${path.basename(filePath)}`, {
      cause: error,
    });
  }

  async function writeWorkspaceUsersConfig(configPayload = {}) {
    const filePath = workspaceUsersFilePath();
    const payload = normalizeWorkspaceUsersConfig(configPayload);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async function readWorkspaceUsers() {
    return normalizeWorkspaceUsersConfig(await readWorkspaceUsersConfig()).users;
  }

  return {
    normalizeWorkspaceUsersConfig,
    readWorkspaceUsersConfig,
    writeWorkspaceUsersConfig,
    readWorkspaceUsers,
  };
}
