/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import fs from "node:fs/promises";
import {
  buildThinkingDetailPayload,
  iterateExecutionLogs,
  readSessionArtifactSnapshot,
} from "noobot-agent/session";
import { HTTP_STATUS } from "noobot-agent/constants";

async function readSegmentedExecutionLogs({
  workspacePath,
  rootSessionId,
  childSessionId,
  skip = 0,
  limit = Infinity,
}) {
  const sessionsRoot = path.resolve(workspacePath, "runtime/session");
  const eventsDir = path.resolve(sessionsRoot, rootSessionId, childSessionId, "execution-events");
  const relative = path.relative(sessionsRoot, eventsDir);
  if (
    !rootSessionId ||
    !childSessionId ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  )
    return [];
  let entries = [];
  try {
    entries = await fs.readdir(eventsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((entry) => entry.isFile() && /^segment-\d+\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const logs = [];
  let seen = 0;
  for (const name of names) {
    try {
      for await (const log of iterateExecutionLogs(path.join(eventsDir, name))) {
        if (seen++ < skip) continue;
        if (logs.length >= limit) return logs;
        logs.push(log);
      }
    } catch {
      continue;
    }
  }
  return logs;
}

export function createPluginServicePorts({ bot = null, translateText = null } = {}) {
  function resolveWorkflowDir({ userId, sessionId, dialogProcessId, locale = "" }) {
    const workspacePath = String(bot?.getWorkspacePath?.(userId) || "").trim();
    if (!workspacePath) throw new Error(translateText?.("common.notFound", locale) || "not found");
    const outputDir = path.resolve(
      workspacePath,
      "runtime/workflow/session",
      String(sessionId || "").trim(),
      String(dialogProcessId || "").trim(),
    );
    const relative = path.relative(path.resolve(workspacePath), outputDir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(translateText?.("common.notFound", locale) || "not found");
    }
    return { workspacePath, outputDir };
  }

  return Object.freeze({
    http: Object.freeze({ status: HTTP_STATUS }),
    sessions: Object.freeze({
      async readWorkflowSnapshot({
        userId,
        sessionId,
        dialogProcessId,
        locale,
        executionPage = null,
      }) {
        const { workspacePath, outputDir } = resolveWorkflowDir({
          userId,
          sessionId,
          dialogProcessId,
          locale,
        });
        let entries = [];
        try {
          entries = await fs.readdir(outputDir);
        } catch (error) {
          if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
        }
        const snapshot = await readSessionArtifactSnapshot({
          outputDir,
          executionLogOptions: executionPage
            ? { skip: executionPage.cursor, limit: executionPage.limit + 1 }
            : {},
        });
        const childSessionId = String(
          snapshot.sessionSummary?.sessionId || snapshot.session?.sessionId || "",
        ).trim();
        const scopedLogs = Array.isArray(snapshot.executionLogs) ? snapshot.executionLogs : [];
        const hasScopedArtifacts =
          entries.includes("execution-events") || entries.includes("execution-events.jsonl");
        const executionLogs =
          scopedLogs.length || (executionPage && hasScopedArtifacts)
            ? scopedLogs
            : await readSegmentedExecutionLogs({
                workspacePath,
                rootSessionId: sessionId,
                childSessionId,
                skip: executionPage?.cursor || 0,
                limit: executionPage ? executionPage.limit + 1 : Infinity,
              });
        return { ...snapshot, executionLogs, childSessionId, artifactNames: entries };
      },
      async readWorkflowThinkingDetail({
        userId,
        sessionId,
        routeDialogProcessId,
        dialogProcessId,
        turnScopeId,
        locale,
      }) {
        const { outputDir } = resolveWorkflowDir({
          userId,
          sessionId,
          dialogProcessId: routeDialogProcessId,
          locale,
        });
        const { session, sessionSummary } = await readSessionArtifactSnapshot({
          outputDir,
          includeExecutionLogs: false,
        });
        const summaryMessage = (
          Array.isArray(sessionSummary?.messages) ? sessionSummary.messages : []
        ).find(
          (message = {}) =>
            String(message?.turnScopeId || "").trim() === String(turnScopeId || "").trim() &&
            (!dialogProcessId ||
              String(message?.dialogProcessId || "").trim() === String(dialogProcessId).trim()),
        );
        return buildThinkingDetailPayload(
          {
            exists: Boolean(session?.sessionId),
            sessionId: String(session?.sessionId || "").trim(),
            revision: String(summaryMessage?.thinkingDetailRef?.contentHash || "").trim(),
            sessions: [
              {
                sessionId: String(session?.sessionId || "").trim(),
                rawMessages: Array.isArray(session?.messages) ? session.messages : [],
              },
            ],
          },
          { dialogProcessId, turnScopeId },
        );
      },
    }),
  });
}
