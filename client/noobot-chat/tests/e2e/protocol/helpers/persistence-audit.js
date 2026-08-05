/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

export function workspaceRoot() {
  return path.resolve(process.env.NOOBOT_E2E_WORKSPACE_ROOT || path.join(repositoryRoot, "workspace"));
}

export function sessionRoot(userId, sessionId) {
  return path.join(workspaceRoot(), userId, "runtime/session", sessionId);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readSessionFact(userId, sessionId) {
  return readJson(path.join(sessionRoot(userId, sessionId), "session.json"));
}

export async function readSnapshots(userId, sessionId) {
  const directory = path.join(sessionRoot(userId, sessionId), "model-message-snapshots");
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readJson(path.join(directory, name))));
}

export async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function readHarnessRun(userId, dialogProcessId) {
  const root = path.join(workspaceRoot(), userId, "runtime/harness/runs", dialogProcessId);
  return {
    run: await readJson(path.join(root, "harness-run.json")),
    context: await readJson(path.join(root, "context-snapshot.json")),
    events: await readJsonLines(path.join(root, "events.jsonl")),
  };
}
