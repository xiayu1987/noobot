/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SESSION_LIFECYCLE_STATUS = Object.freeze({ DELETING: "deleting", DELETED: "deleted" });

export function resolveSessionLifecycleFile({ workspaceRoot = "/workspace", userId = "" } = {}) {
  return path.join(path.resolve(String(workspaceRoot)), String(userId).trim(), "runtime", "session-state", "deletions.json");
}

async function readPayload(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return { sessions: parsed?.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {}, updatedAt: parsed?.updatedAt || "" };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return { sessions: {}, updatedAt: "" };
    throw error;
  }
}

async function writeAtomic(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(temporary, file);
}

export async function readSessionLifecycleState(options = {}) {
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId || !String(options.userId || "").trim()) return null;
  const payload = await readPayload(resolveSessionLifecycleFile(options));
  return payload.sessions[sessionId] || null;
}

export async function isSessionDeletionBlocked(options = {}) {
  const state = await readSessionLifecycleState(options);
  return state?.status === SESSION_LIFECYCLE_STATUS.DELETING || state?.status === SESSION_LIFECYCLE_STATUS.DELETED;
}

export async function updateSessionLifecycleStates(options = {}) {
  const ids = (Array.isArray(options.sessionIds) ? options.sessionIds : [options.sessionIds])
    .map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length || !String(options.userId || "").trim()) return 0;
  const file = resolveSessionLifecycleFile(options);
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try { await fs.mkdir(lock); acquired = true; break; }
    catch (error) { if (error?.code !== "EEXIST") throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  if (!acquired) throw new Error("session lifecycle state lock timeout");
  try {
    const payload = await readPayload(file);
    const updatedAt = options.updatedAt || new Date().toISOString();
    for (const sessionId of ids) payload.sessions[sessionId] = { status: options.status, updatedAt, ...(options.operationId ? { operationId: options.operationId } : {}) };
    payload.updatedAt = updatedAt;
    await writeAtomic(file, payload);
    return ids.length;
  } finally { await fs.rm(lock, { recursive: true, force: true }); }
}

export async function clearSessionLifecycleState(options = {}) {
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) return false;
  const file = resolveSessionLifecycleFile(options);
  const payload = await readPayload(file);
  if (!payload.sessions[sessionId]) return false;
  delete payload.sessions[sessionId];
  payload.updatedAt = new Date().toISOString();
  await writeAtomic(file, payload);
  return true;
}
