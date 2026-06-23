/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  buildSessionDisplaySummary,
  isSessionDisplaySummaryPayload,
} from "./session-summary-builders.js";

export const SESSION_ARTIFACT_FILE_NAMES = Object.freeze({
  session: "session.json",
  sessionSummary: "session-summary.json",
  task: "task.json",
  execution: "execution.json",
  executionEvents: "execution.jsonl",
  meta: "meta.json",
});

export function buildSessionArtifactFileMap(sessionDir = "") {
  const dir = String(sessionDir || "").trim();
  return {
    session: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.session),
    sessionSummary: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummary),
    task: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.task),
    execution: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.execution),
    executionEvents: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEvents),
    meta: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.meta),
  };
}

export async function writeJsonArtifactFile(filePath = "", payload = {}) {
  await writeFile(
    filePath,
    `${JSON.stringify(payload && typeof payload === "object" ? payload : {}, null, 2)}\n`,
    "utf8",
  );
}

export async function readJsonArtifactFile(filePath = "", fallback = null) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJsonlArtifactFile(filePath = "", logs = []) {
  const lines = (Array.isArray(logs) ? logs : [])
    .map((log) => JSON.stringify(log && typeof log === "object" ? log : { value: log }))
    .join("\n");
  await writeFile(filePath, lines ? `${lines}\n` : "", "utf8");
}

export async function appendJsonlArtifactLog(filePath = "", log = {}, { reset = false } = {}) {
  const serializedLog = `${JSON.stringify(log && typeof log === "object" ? log : { value: log })}\n`;
  if (reset) {
    await writeFile(filePath, serializedLog, "utf8");
  } else {
    await appendFile(filePath, serializedLog, "utf8");
  }
}

export async function readJsonlArtifactFile(filePath = "") {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeJsonWithStorage({
  storageService = null,
  filePath = "",
  payload = {},
  atomic = false,
} = {}) {
  if (storageService && typeof storageService.writeJsonAtomic === "function" && atomic) {
    return storageService.writeJsonAtomic(filePath, payload);
  }
  if (storageService && typeof storageService.writeJson === "function") {
    return storageService.writeJson(filePath, payload);
  }
  return writeJsonArtifactFile(filePath, payload);
}

async function readJsonWithStorage({
  storageService = null,
  filePath = "",
  fallback = null,
} = {}) {
  if (storageService && typeof storageService.readJson === "function") {
    return storageService.readJson(filePath, fallback);
  }
  return readJsonArtifactFile(filePath, fallback);
}

export async function writeSessionArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
  depth = 0,
  atomic = true,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  const summaryPayload = buildSessionDisplaySummary(sessionPayload, { depth });
  await Promise.all([
    writeJsonWithStorage({
      storageService,
      filePath: files.session,
      payload: sessionPayload,
      atomic,
    }),
    writeJsonWithStorage({
      storageService,
      filePath: files.sessionSummary,
      payload: summaryPayload,
      atomic: true,
    }),
  ]);
  return {
    files,
    session: sessionPayload,
    sessionSummary: summaryPayload,
  };
}

export async function readSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionId = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const payload = await readJsonWithStorage({
    storageService,
    filePath: files.sessionSummary,
    fallback: null,
  });
  if (!isSessionDisplaySummaryPayload(payload, sessionId)) return null;
  return payload;
}

export async function rebuildSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
  depth = 0,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const summaryPayload = buildSessionDisplaySummary(sessionPayload, { depth });
  await writeJsonWithStorage({
    storageService,
    filePath: files.sessionSummary,
    payload: summaryPayload,
    atomic: true,
  });
  return summaryPayload;
}

export async function writeTaskArtifact({
  storageService = null,
  sessionDir = "",
  taskPayload = {},
  atomic = false,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    filePath: files.task,
    payload: taskPayload,
    atomic,
  });
  return { files, task: taskPayload };
}

export async function writeExecutionArtifact({
  storageService = null,
  sessionDir = "",
  executionPayload = {},
  atomic = true,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    filePath: files.execution,
    payload: executionPayload,
    atomic,
  });
  return { files, execution: executionPayload };
}

export async function appendExecutionLogArtifact({
  storageService = null,
  sessionDir = "",
  executionLog = {},
  executionPayload = {},
  resetExecutionLogs = false,
  atomic = true,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await appendJsonlArtifactLog(files.executionEvents, executionLog, { reset: resetExecutionLogs });
  await writeExecutionArtifact({
    storageService,
    sessionDir,
    executionPayload,
    atomic,
  });
  return { files, executionLog, execution: executionPayload };
}

export async function persistSessionArtifactSnapshot({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionPayload = {},
  metadata = null,
} = {}) {
  await mkdir(outputDir, { recursive: true });
  const files = buildSessionArtifactFileMap(outputDir);
  const normalizedExecutionPayload =
    executionPayload && typeof executionPayload === "object" ? executionPayload : {};
  const executionLogs = Array.isArray(normalizedExecutionPayload?.logs)
    ? normalizedExecutionPayload.logs
    : [];
  await Promise.all([
    writeSessionArtifact({
      sessionDir: outputDir,
      sessionPayload: sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {},
    }),
    writeTaskArtifact({
      sessionDir: outputDir,
      taskPayload: taskPayload && typeof taskPayload === "object" ? taskPayload : {},
    }),
    writeExecutionArtifact({
      sessionDir: outputDir,
      executionPayload: normalizedExecutionPayload,
    }),
    writeJsonlArtifactFile(files.executionEvents, executionLogs),
    writeJsonArtifactFile(files.meta, metadata && typeof metadata === "object" ? metadata : {}),
  ]);
  return {
    outputDir,
    files,
  };
}

export async function readSessionArtifactSnapshot({ outputDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(outputDir);
  const [session, sessionSummaryRaw, task, execution, executionLogs, meta] = await Promise.all([
    readJsonArtifactFile(files.session, null),
    readJsonArtifactFile(files.sessionSummary, null),
    readJsonArtifactFile(files.task, null),
    readJsonArtifactFile(files.execution, null),
    readJsonlArtifactFile(files.executionEvents),
    readJsonArtifactFile(files.meta, null),
  ]);
  const sessionSummary = isSessionDisplaySummaryPayload(
    sessionSummaryRaw,
    String(session?.sessionId || "").trim(),
  )
    ? sessionSummaryRaw
    : null;
  return {
    files,
    session,
    sessionSummary,
    task,
    execution,
    executionLogs,
    meta,
  };
}
