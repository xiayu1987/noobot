/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { readPersistedJsonFile } from "../../shared/storage/json-file-reader.js";
import { renderLongMemoryMetadataItems } from "./reader.js";

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function hasCurrentText(filePath) {
  if (!(await pathExists(filePath))) return false;
  return Boolean(String(await readFile(filePath, "utf8")).trim());
}

function renderLegacyLongMemory(payload = {}) {
  const content =
    typeof payload?.staticMemory === "string"
      ? payload.staticMemory
      : typeof payload?.memory === "string"
        ? payload.memory
        : "";
  return String(content || "").trim();
}

function renderLegacyLongMemoryModel(payload = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return JSON.stringify(payload, null, 2);
}

async function prepareMigration({ legacyPath, currentPath, render }) {
  if (await hasCurrentText(currentPath)) return null;
  if (!(await pathExists(legacyPath))) return null;
  const payload = await readPersistedJsonFile({ filePath: legacyPath, readFile });
  const content = String(render(payload) || "").trim();
  if (!content) return null;
  return { currentPath, content: `${content}\n` };
}

export async function migrateLegacyLongMemoryFiles(basePath = "") {
  const memoryDir = path.join(basePath, "memory");
  const migrations = (
    await Promise.all([
      prepareMigration({
        legacyPath: path.join(memoryDir, "long-memory.json"),
        currentPath: path.join(memoryDir, "long-memory.md"),
        render: renderLegacyLongMemory,
      }),
      prepareMigration({
        legacyPath: path.join(memoryDir, "long-memory", "metadata.json"),
        currentPath: path.join(memoryDir, "long-memory", "metadata.md"),
        render: (payload) => renderLongMemoryMetadataItems(payload?.items),
      }),
      prepareMigration({
        legacyPath: path.join(memoryDir, "long-memory-model.json"),
        currentPath: path.join(memoryDir, "long-memory-model.md"),
        render: renderLegacyLongMemoryModel,
      }),
    ])
  ).filter(Boolean);
  if (!migrations.length) return { migrated: [] };

  const staged = [];
  try {
    for (const [index, migration] of migrations.entries()) {
      await mkdir(path.dirname(migration.currentPath), { recursive: true });
      const temporaryPath = `${migration.currentPath}.migration-${process.pid}-${index}`;
      await writeFile(temporaryPath, migration.content, "utf8");
      staged.push({ ...migration, temporaryPath });
    }
    for (const migration of staged) {
      await rename(migration.temporaryPath, migration.currentPath);
    }
  } catch (error) {
    await Promise.all(staged.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
    throw error;
  }
  return { migrated: migrations.map(({ currentPath }) => currentPath) };
}
