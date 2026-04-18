/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, cp, stat } from "node:fs/promises";
import path from "node:path";

function resolveTemplateBase(workspaceTemplatePath = "") {
  const configuredTemplatePath = String(workspaceTemplatePath || "").trim();
  if (!configuredTemplatePath) {
    throw new Error("workspaceTemplatePath required");
  }
  return path.resolve(configuredTemplatePath);
}

export async function ensureUserWorkspaceInitialized({
  workspaceRoot,
  workspaceTemplatePath = "",
  userId,
}) {
  const base = path.resolve(workspaceRoot, userId);
  const templateBase = resolveTemplateBase(workspaceTemplatePath);
  try {
    await access(templateBase);
  } catch {
    throw new Error(
      `workspace template missing: ${templateBase}`,
    );
  }

  let baseExists = true;
  try {
    await access(base);
  } catch {
    baseExists = false;
  }

  if (baseExists) {
    const baseStat = await stat(base);
    if (!baseStat.isDirectory()) {
      throw new Error(`user workspace path is not a directory: ${base}`);
    }
    // 目录已存在时，补齐模板中的缺失结构，不覆盖用户已有内容
    await cp(templateBase, base, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    return base;
  }

  await cp(templateBase, base, { recursive: true, force: false });
  return base;
}
