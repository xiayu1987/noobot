/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, readdir } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { fatalSystemError } from "../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { ERROR_CODE } from "../shared/errors/constants.js";
import { text } from "@noobot/shared/value";

export class SkillService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = text(userId);
    const workspaceRoot = text(this.globalConfig?.workspaceRoot);
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError(tSystem("common.workspaceRootUserIdRequired"), {
        code: ERROR_CODE.FATAL_WORKSPACE_PATH_INVALID,
      });
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  async listSkills({ userId }) {
    const basePath = this._resolveBasePath(userId);
    const skillRoot = path.join(basePath, "skills");
    let level1Entries = [];
    try {
      level1Entries = await readdir(skillRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const names = level1Entries
      .filter((entryItem) => entryItem.isDirectory())
      .map((entryItem) => entryItem.name);

    return Promise.all(
      names.map(async (name) => {
        const configPath = path.join(skillRoot, name, "config.json");
        try {
          const cfg = JSON.parse(await readFile(configPath, "utf8"));
          return {
            name,
            description: cfg.description || "",
            model: cfg.model || null,
          };
        } catch {
          return { name, description: "", model: null };
        }
      }),
    );
  }
}
