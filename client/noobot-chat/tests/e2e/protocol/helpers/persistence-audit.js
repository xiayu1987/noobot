/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readSessionArtifact } from "noobot-agent/session";

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

async function findFilesNamed(directory, filename) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const matches = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findFilesNamed(child, filename));
    else if (entry.isFile() && entry.name === filename) matches.push(child);
  }
  return matches;
}

function failSummaryAudit(message, report) {
  const error = new Error(message);
  error.code = "E2E_SESSION_SUMMARY_ARTIFACT_INVALID";
  error.audit = report;
  throw error;
}

export async function auditSessionSummaryArtifacts(userId, sessionId, { expectation = "required" } = {}) {
  const root = sessionRoot(userId, sessionId);
  const summaryFiles = (await findFilesNamed(root, "session-summary.json")).sort();
  const sessionsIndexFile = path.join(workspaceRoot(), userId, "runtime/session/sessions.json");
  let sessionsIndex = null;
  try {
    sessionsIndex = await readJson(sessionsIndexFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const indexedSession = (Array.isArray(sessionsIndex?.sessions) ? sessionsIndex.sessions : [])
    .find((item) => String(item?.sessionId || "").trim() === sessionId) || null;
  const report = {
    protocolVersion: 1,
    authority: "session_summary_artifact",
    rootSessionId: sessionId,
    expectation,
    status: "passed",
    summaryCount: summaryFiles.length,
    referencedDetailCount: 0,
    summaryBytes: 0,
    detailBytes: 0,
    listAvailability: String(indexedSession?.availability || ""),
    sessions: [],
  };
  if (expectation === "forbidden") {
    if (summaryFiles.length) failSummaryAudit(`unprovisioned session created summary artifacts: ${sessionId}`, report);
    if (indexedSession) failSummaryAudit(`unprovisioned session created a sessions index entry: ${sessionId}`, report);
    return report;
  }
  if (expectation === "unavailable") {
    const reason = indexedSession?.unavailableReason;
    if (indexedSession?.availability !== "unavailable"
      || !Array.isArray(indexedSession?.messages) || indexedSession.messages.length
      || Number(indexedSession?.messageCount) !== 0 || indexedSession?.lastMessage !== null
      || !String(reason?.code || "").trim() || !String(reason?.message || "").trim()) {
      failSummaryAudit(`invalid unavailable sessions index projection: ${sessionId}`, report);
    }
    return report;
  }
  if (expectation !== "required") failSummaryAudit(`invalid summary audit expectation: ${expectation}`, report);
  if (indexedSession?.availability !== "available") {
    failSummaryAudit(`available session is missing its canonical sessions index projection: ${sessionId}`, report);
  }
  if (!summaryFiles.length) failSummaryAudit(`session summary artifact is missing: ${sessionId}`, report);

  for (const summaryFile of summaryFiles) {
    const sessionDir = path.dirname(summaryFile);
    const summary = await readJson(summaryFile);
    const messages = Array.isArray(summary?.messages) ? summary.messages : [];
    const summaryStat = await fs.stat(summaryFile);
    const detailsRoot = path.resolve(sessionDir, "session-summary-details");
    const referencedFiles = new Set();
    let detailBytes = 0;
    let referencedDetailCount = 0;

    for (const message of messages) {
      if (Object.hasOwn(message, "toolTimeline") || Object.hasOwn(message, "activityTimeline")) {
        failSummaryAudit(`session summary embeds thinking timeline: ${summaryFile}`, report);
      }
      const ref = message?.thinkingDetailRef;
      if (ref === undefined) continue;
      const reference = String(ref?.file || "").replaceAll("\\", "/");
      const normalizedReference = path.normalize(reference);
      const detailFile = path.resolve(sessionDir, normalizedReference);
      if (!reference || path.isAbsolute(reference) || reference.includes("\0")
        || !reference.startsWith("session-summary-details/")
        || detailFile === detailsRoot || !detailFile.startsWith(`${detailsRoot}${path.sep}`)) {
        failSummaryAudit(`invalid session summary detail reference: ${reference}`, report);
      }
      if (referencedFiles.has(detailFile)) {
        failSummaryAudit(`duplicate session summary detail reference: ${reference}`, report);
      }
      referencedFiles.add(detailFile);
      const detail = await readJson(detailFile);
      const detailHash = `sha256:${createHash("sha256").update(JSON.stringify(detail)).digest("hex")}`;
      const presentationMessageId = String(
        message?.presentationMessageId || message?.messageId || message?.id || "",
      ).trim();
      if (detailHash !== ref?.contentHash || detail?.presentationMessageId !== presentationMessageId) {
        failSummaryAudit(`session summary detail identity or hash mismatch: ${reference}`, report);
      }
      const toolTimeline = Array.isArray(detail?.toolTimeline) ? detail.toolTimeline : [];
      const activityTimeline = Array.isArray(detail?.activityTimeline) ? detail.activityTimeline : [];
      const detailEventCount = toolTimeline.reduce(
        (count, entry = {}) => count + Number(Boolean(entry?.call)) + Number(Boolean(entry?.resultEvent)),
        0,
      ) + activityTimeline.length;
      if (detailEventCount !== Number(message?.thinkingDetailCount || 0)) {
        failSummaryAudit(`session summary detail count mismatch: ${reference}`, report);
      }
      detailBytes += (await fs.stat(detailFile)).size;
      referencedDetailCount += 1;
    }

    let detailNames = [];
    try {
      detailNames = (await fs.readdir(detailsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(detailsRoot, entry.name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const orphanFiles = detailNames.filter((detailFile) => !referencedFiles.has(detailFile));
    if (orphanFiles.length) {
      failSummaryAudit(`orphan session summary details: ${orphanFiles.join(", ")}`, report);
    }
    report.summaryBytes += summaryStat.size;
    report.detailBytes += detailBytes;
    report.referencedDetailCount += referencedDetailCount;
    report.sessions.push({
      sessionId: String(summary?.sessionId || ""),
      summaryFile: path.relative(root, summaryFile).replaceAll("\\", "/"),
      summaryBytes: summaryStat.size,
      detailBytes,
      messageCount: messages.length,
      referencedDetailCount,
      embeddedTimelineCount: 0,
      orphanDetailCount: 0,
    });
  }
  return report;
}

export async function readSessionTurnMessages(userId, sessionId) {
  const session = await readSessionArtifact({ sessionDir: sessionRoot(userId, sessionId) });
  return Array.isArray(session?.messages) ? session.messages : [];
}

export async function readSnapshots(userId, sessionId) {
  const directory = path.join(sessionRoot(userId, sessionId), "model-message-snapshots");
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readJson(path.join(directory, name))));
}

export function parseJsonLines(text, { committedFramesOnly = false } = {}) {
  const source = String(text || "");
  const lines = source.split(/\r?\n/);
  if (committedFramesOnly && source && !source.endsWith("\n")) lines.pop();
  return lines.filter(Boolean).map((line) => JSON.parse(line));
}

export async function readJsonLines(filePath, options = {}) {
  const text = await fs.readFile(filePath, "utf8");
  return parseJsonLines(text, options);
}

async function readJsonLinesIfPresent(filePath, options = {}) {
  try {
    return await readJsonLines(filePath, options);
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
  return (await Promise.all(names.map((name) => readJsonLinesIfPresent(
    path.join(eventsDir, name),
    { committedFramesOnly: true },
  )))).flat();
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
    readJsonLinesIfPresent(path.join(executionDir, name), { committedFramesOnly: true }),
  ))).flat();
}

async function findExecutionEventSegments(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const segments = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (entry.name === "execution-events") {
      const names = (await fs.readdir(child))
        .filter((name) => /^segment-\d+\.jsonl$/.test(name))
        .sort();
      segments.push(...names.map((name) => path.join(child, name)));
      continue;
    }
    segments.push(...await findExecutionEventSegments(child));
  }
  return segments;
}

export async function readSessionExecutionEventTree(userId, sessionId, { rootSessionId = "" } = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const hasExplicitRoot = Boolean(String(rootSessionId || "").trim());
  const normalizedRootSessionId = String(rootSessionId || normalizedSessionId).trim();
  if (!normalizedSessionId || !normalizedRootSessionId) return [];
  // Workflow child execution trees are canonically scoped below their root
  // session. A child id alone is not a filesystem scope and must never be
  // resolved as a top-level session.
  const segments = await findExecutionEventSegments(sessionRoot(userId, normalizedRootSessionId));
  const records = (await Promise.all(segments.sort().map((segment) =>
    readJsonLinesIfPresent(segment, { committedFramesOnly: true }),
  ))).flat();
  return hasExplicitRoot
    ? records.filter((record) => String(record?.sessionId || "").trim() === normalizedSessionId)
    : records;
}

export function modelInvocationTraces(records) {
  return records.filter((record) =>
    record.event === "model_context_trace" &&
    record.data?.stage === "llm_invoke_messages" &&
    record.data?.authority === "model_invoke_port",
  );
}

export async function waitForSessionExecutionEventTree(
  userId,
  sessionId,
  predicate,
  { timeoutMs = 120000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let records = [];
  while (Date.now() < deadline) {
    records = await readSessionExecutionEventTree(userId, sessionId);
    if (predicate(records)) return records;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`execution event tree did not converge for session ${sessionId}: ${JSON.stringify(records)}`);
}

export async function waitForModelInvocationTraces(
  userId,
  sessionId,
  predicate,
  { timeoutMs = 120000 } = {},
) {
  let traces = [];
  await waitForSessionExecutionEventTree(userId, sessionId, (records) => {
    traces = modelInvocationTraces(records);
    return predicate(traces);
  }, { timeoutMs });
  return traces;
}

export async function readAttachmentIndex(userId, sessionId, attachmentSource) {
  return readJson(path.join(
    workspaceRoot(),
    userId,
    "runtime/attach/scoped",
    sessionId,
    attachmentSource,
    "attachments.json",
  ));
}

export async function waitForPluginRuntimeEvents(userId, sessionId, predicate, { timeoutMs = 15000 } = {}) {
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

export async function waitForPluginExecutionEvents(userId, sessionId, predicate, { timeoutMs = 15000 } = {}) {
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
    capabilityTraces: await readJsonLinesIfPresent(path.join(root, "capability-traces.jsonl")),
  };
}


export async function waitForHarnessRun(userId, dialogProcessId, predicate, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let run = null;
  while (Date.now() < deadline) {
    try {
      run = await readHarnessRun(userId, dialogProcessId);
      if (predicate(run)) return run;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Harness run did not converge for dialog ${dialogProcessId}: ${JSON.stringify(run)}`);
}
