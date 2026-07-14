import fs from 'node:fs/promises';
import path from 'node:path';

export const DELETED_SESSIONS_MARKER_FILE = '.deleted-sessions.json';

export function resolveWorkspaceSessionPaths({ workspaceRoot, userId, sessionId } = {}) {
  const normalizedWorkspaceRoot = String(workspaceRoot || '').trim();
  const normalizedUserId = String(userId || '').trim();
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedWorkspaceRoot || !normalizedUserId || !normalizedSessionId) return null;
  const sessionRoot = path.join(path.resolve(normalizedWorkspaceRoot), normalizedUserId, 'runtime', 'session');
  return {
    markerFile: path.join(sessionRoot, DELETED_SESSIONS_MARKER_FILE),
    sessionDir: path.join(sessionRoot, normalizedSessionId),
  };
}

export async function isWorkspaceSessionDeleted(context = {}) {
  const paths = resolveWorkspaceSessionPaths(context);
  if (!paths) return false;
  try {
    const marker = JSON.parse(await fs.readFile(paths.markerFile, 'utf8'));
    return Boolean(marker?.sessions?.[String(context.sessionId || '').trim()]);
  } catch {
    return false;
  }
}

export async function removeSessionDirectoryIfDeleted(context = {}) {
  const paths = resolveWorkspaceSessionPaths(context);
  if (!paths || !(await isWorkspaceSessionDeleted(context))) return false;
  await fs.rm(paths.sessionDir, { recursive: true, force: true });
  return true;
}
