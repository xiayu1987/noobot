/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fatalSystemError } from "../error/index.js";

export class SkillService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw fatalSystemError("workspaceRoot/userId required", {
        code: "FATAL_WORKSPACE_PATH_INVALID",
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
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return Promise.all(names.map(async (name) => {
      const configPath = path.join(skillRoot, name, "config.json");
      try {
        await access(configPath);
        const cfg = JSON.parse(await readFile(configPath, "utf8"));
        return {
          name,
          description: cfg.description || "",
          model: cfg.model || null,
        };
      } catch {
        return { name, description: "", model: null };
      }
    }));
  }
}
