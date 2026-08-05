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

async function readJsonLinesIfPresent(filePath) {
  try {
    return await readJsonLines(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function readSessionRuntimeEvents(userId, sessionId) {
  const eventsDir = path.join(sessionRoot(userId, sessionId), "events");
  let names = [];
  try {
    names = (await fs.readdir(eventsDir)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return (await Promise.all(names.map((name) => readJsonLinesIfPresent(path.join(eventsDir, name))))).flat();
}

export async function readSessionExecutionEvents(userId, sessionId) {
  const executionDir = path.join(sessionRoot(userId, sessionId), "execution-events");
  let names = [];
  try {
    names = (await fs.readdir(executionDir))
      .filter((name) => /^segment-\d+\.jsonl$/.test(name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return (await Promise.all(names.map((name) =>
    readJsonLinesIfPresent(path.join(executionDir, name)),
  ))).flat();
}

export async function readUserAttachmentIndex(userId, sessionId) {
  return readJson(path.join(
    workspaceRoot(),
    userId,
    "runtime/attach/scoped",
    sessionId,
    "user/attachments.json",
  ));
}

export async function waitForPluginRuntimeEvents(userId, sessionId, predicate, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  while (Date.now() < deadline) {
    events = (await readSessionRuntimeEvents(userId, sessionId)).filter((record) =>
      String(record?.event || "").startsWith("plugin."),
    );
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`plugin runtime events did not converge for session ${sessionId}: ${JSON.stringify(events)}`);
}

export async function waitForPluginExecutionEvents(userId, sessionId, predicate, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  while (Date.now() < deadline) {
    events = (await readSessionExecutionEvents(userId, sessionId)).filter((record) =>
      String(record?.event || "").startsWith("plugin."),
    );
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`plugin execution events did not converge for session ${sessionId}: ${JSON.stringify(events)}`);
}

export async function readHarnessRun(userId, dialogProcessId) {
  const root = path.join(workspaceRoot(), userId, "runtime/harness/runs", dialogProcessId);
  return {
    run: await readJson(path.join(root, "harness-run.json")),
    context: await readJson(path.join(root, "context-snapshot.json")),
    events: await readJsonLines(path.join(root, "events.jsonl")),
  };
}
