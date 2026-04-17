/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export class SkillService {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
  }

  _resolveBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    if (!normalizedUserId || !workspaceRoot) {
      throw new Error("workspaceRoot/userId required");
    }
    return path.resolve(workspaceRoot, normalizedUserId);
  }

  listSkills({ userId }) {
    const basePath = this._resolveBasePath(userId);
    const skillRoot = path.join(basePath, "skills");
    const names = readdirSync(skillRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return names.map((name) => {
      const configPath = path.join(skillRoot, name, "config.json");
      if (existsSync(configPath)) {
        const cfg = JSON.parse(readFileSync(configPath, "utf8"));
        return {
          name,
          description: cfg.description || "",
          model: cfg.model || null,
        };
      }
      return { name, description: "", model: null };
    });
  }

  getSkill({ userId, skillName }) {
    const basePath = this._resolveBasePath(userId);
    const root = path.join(basePath, "skills", skillName);
    const flowPath = path.join(root, "flow.json");
    const cfgPath = path.join(root, "config.json");
    const indexPath = path.join(root, "knowledge-base/index.json");

    const flow = existsSync(flowPath)
      ? JSON.parse(readFileSync(flowPath, "utf8"))
      : {};
    const config = existsSync(cfgPath)
      ? JSON.parse(readFileSync(cfgPath, "utf8"))
      : {};
    const kbIndex = existsSync(indexPath)
      ? JSON.parse(readFileSync(indexPath, "utf8"))
      : {};

    return { flow, config, kbIndex, root };
  }
}
