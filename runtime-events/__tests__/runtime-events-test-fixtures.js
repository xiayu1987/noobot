/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveWorkspaceSessionPaths } from '../src/session-deletion-guard.js';

export async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'runtime-events-'));
}

export async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function markSessionDeleted(workspaceRoot, userId, sessionId) {
  const paths = resolveWorkspaceSessionPaths({ workspaceRoot, userId, sessionId });
  await fs.mkdir(path.dirname(paths.markerFile), { recursive: true });
  await fs.writeFile(paths.markerFile, JSON.stringify({
    sessions: { [sessionId]: { deletedAt: new Date().toISOString() } },
  }), 'utf8');
  return paths;
}

export async function persistSession(workspaceRoot, userId, sessionId) {
  const sessionDir = path.join(workspaceRoot, userId, 'runtime', 'session', sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify({ sessionId }), 'utf8');
  return sessionDir;
}

export async function writeArchive(file, ageMs = 0) {
  await fs.writeFile(file, `${JSON.stringify({ archived: path.basename(file) })}\n`, 'utf8');
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
  return file;
}
