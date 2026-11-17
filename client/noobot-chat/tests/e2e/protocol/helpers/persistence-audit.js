/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import {
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_DIRECTORIES,
} from "@noobot/session-protocol/immutable-storage";
import { requireWorkspaceRootEnv } from "@noobot/runtime-topology-protocol/workspace-root";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import {
  SESSION_TREE_ERROR,
  normalizeSessionTree,
  resolveSessionDirSegments,
} from "@noobot/workspace-protocol/session-tree";
import {
  openSessionArtifactReader,
  withSessionArtifactReadFence,
  StorageService,
  PathResolver,
  SessionPathResolver,
  FileSystemSessionRepository,
  FileSystemSessionTreeRepository,
} from "noobot-agent/session";
import { PROTOCOL_TIMEOUTS } from "./protocol-timeouts.js";

import { text } from "@noobot/shared/value";
import { MODEL_CONTEXT_TRACE } from "@noobot/model-protocol";
import { isRotatedPluginLogName } from "@noobot/plugin-protocol/log-artifact";
export function workspaceRoot() {
  return requireWorkspaceRootEnv();
}

export async function sessionRoot(userId, sessionId) {
  const userRoot = path.join(workspaceRoot(), userId);
  const tree = normalizeSessionTree(
    await readJson(path.join(userRoot, WORKSPACE_LAYOUT.SESSION_TREE_FILE)),
  );
  return path.join(userRoot, ...resolveSessionDirSegments(tree, sessionId));
}

async function persistedSessionRoot(userId, sessionId) {
  try {
    return await sessionRoot(userId, sessionId);
  } catch (error) {
    if (error?.code === SESSION_TREE_ERROR.NODE_MISSING) return "";
    throw error;
  }
}

async function readParentSessionId(sessionDir) {
  await using reader = await openSessionArtifactReader({ sessionDir });
  return (await reader.readMetadata()).parentSessionId;
}

async function detachedDescendantRoots(userId, rootSessionId) {
  const agentSessionDir = path.join(workspaceRoot(), userId, WORKSPACE_LAYOUT.AGENT_SESSION_DIR);
  let names = [];
  try {
    names = (await fs.readdir(agentSessionDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const tree = normalizeSessionTree(
    await readJson(path.join(workspaceRoot(), userId, WORKSPACE_LAYOUT.SESSION_TREE_FILE)),
  );
  const parentById = new Map([
    ...Object.values(tree.nodes).map((node) => [node.sessionId, node.parentSessionId]),
    ...(await Promise.all(
      names.map(async (name) => [
        name,
        await readParentSessionId(path.join(agentSessionDir, name)),
      ]),
    )),
  ]);
  const belongsToRoot = (sessionId) => {
    const visited = new Set();
    let current = parentById.get(sessionId);
    while (current && !visited.has(current)) {
      if (current === rootSessionId) return true;
      visited.add(current);
      current = parentById.get(current);
    }
    return false;
  };
  return names.filter(belongsToRoot).map((name) => path.join(agentSessionDir, name));
}

async function sessionTreeRoots(userId, rootSessionId) {
  return [
    await persistedSessionRoot(userId, rootSessionId),
    path.join(workspaceRoot(), userId, "runtime/plugin-data/workflow/session", rootSessionId),
    ...(await detachedDescendantRoots(userId, rootSessionId)),
  ].filter(Boolean);
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readSessionFact(userId, sessionId) {
  const repository = auditRepository();
  await using reader = await repository.requireSessionReader(userId, sessionId, {
    persistenceContext: repository.treePersistenceContext(userId, sessionId),
  });
  return await reader.exportSession();
}

function auditRepository() {
  const pathResolver = new PathResolver({ workspaceRoot: workspaceRoot() });
  const storageService = new StorageService({
    atomicRenameRetryDelaysMs: [],
    platform: process.platform,
  });
  const sessionTreeRepository = new FileSystemSessionTreeRepository({
    pathResolver,
    storageService,
  });
  return new FileSystemSessionRepository({
    pathResolver,
    storageService,
    sessionTreeRepository,
    sessionPathResolver: new SessionPathResolver({
      pathResolver,
      treeRepository: sessionTreeRepository,
    }),
    now: () => new Date().toISOString(),
  });
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
    if (entry.isDirectory() && !Object.values(IMMUTABLE_SESSION_DIRECTORIES).includes(entry.name))
      matches.push(...(await findFilesNamed(child, filename)));
    else if (entry.isFile() && entry.name === filename) matches.push(child);
  }
  return matches;
}

function failSummaryAudit(message, report) {
  report.status = "failed";
  const error = new Error(message);
  error.code = "E2E_SESSION_SUMMARY_ARTIFACT_INVALID";
  error.audit = report;
  throw error;
}

export async function auditSessionSummaryArtifacts(
  userId,
  sessionId,
  { expectation = "required", requiredTitlePrefix = "" } = {},
) {
  const root = await persistedSessionRoot(userId, sessionId);
  const auditRoots =
    expectation === "required" ? await sessionTreeRoots(userId, sessionId) : [root].filter(Boolean);
  const discoveredHeads = await Promise.all(
    auditRoots.map((directory) => findFilesNamed(directory, IMMUTABLE_SESSION_HEAD_FILE)),
  );
  const heads = [...new Set(discoveredHeads.flat())].sort();
  return withSessionArtifactReadFence(
    heads.map((file) => path.dirname(file)),
    () =>
      auditSessionSummaryHeads({
        root,
        heads,
        userId,
        sessionId,
        expectation,
        requiredTitlePrefix,
      }),
  );
}

async function auditSessionSummaryHeads({
  root,
  heads,
  userId,
  sessionId,
  expectation,
  requiredTitlePrefix,
}) {
  const headVersions = await Promise.all(heads.map((file) => fs.readFile(file)));
  const repository = auditRepository();
  const list = await repository.readSessionsSummary(userId);
  const indexedSession = list.sessions.find((item) => item.sessionId === sessionId) || null;
  const report = {
    protocolVersion: 2,
    authority: "immutable_session_projection",
    rootSessionId: sessionId,
    expectation,
    status: "passed",
    projectionCount: heads.length,
    thinkingDetailCount: 0,
    projectionBytes: 0,
    detailBytes: 0,
    listAvailability: String(indexedSession?.availability || ""),
    listTitle: String(indexedSession?.title || ""),
    sessions: [],
  };
  if (expectation === "forbidden") {
    if (heads.length)
      failSummaryAudit(`unprovisioned session published an immutable head: ${sessionId}`, report);
    if (indexedSession)
      failSummaryAudit(
        `unprovisioned session created a sessions index entry: ${sessionId}`,
        report,
      );
    return report;
  }
  if (expectation === "unavailable") {
    if (indexedSession?.availability !== "unavailable")
      failSummaryAudit(`expected an unavailable list projection: ${sessionId}`, report);
    return report;
  }
  if (expectation !== "required")
    failSummaryAudit(`invalid summary audit expectation: ${expectation}`, report);
  if (indexedSession?.availability !== "available") {
    failSummaryAudit(
      `available session is missing its canonical list projection: ${sessionId}`,
      report,
    );
  }
  if (requiredTitlePrefix && !String(indexedSession.title || "").startsWith(requiredTitlePrefix)) {
    failSummaryAudit(
      `session title is missing required identity prefix ${requiredTitlePrefix}: ${sessionId}`,
      report,
    );
  }
  if (!heads.includes(path.join(root, IMMUTABLE_SESSION_HEAD_FILE)))
    failSummaryAudit(`committed session head is missing: ${sessionId}`, report);

  for (const [index, headFile] of heads.entries()) {
    await using reader = await openSessionArtifactReader({ sessionDir: path.dirname(headFile) });
    if (!(await fs.readFile(headFile)).equals(headVersions[index]))
      failSummaryAudit(`session changed during persistence audit: ${headFile}`, report);
    const [summary, facts, metadata, listProjection] = await Promise.all([
      reader.readDisplayProjection(),
      reader.readFacts(),
      reader.readMetadata(),
      reader.readListProjection(),
    ]);
    if (
      summary.sessionId !== metadata.sessionId ||
      facts.messageCount !== listProjection.messageCount
    )
      failSummaryAudit(`session projection identity or count mismatch: ${headFile}`, report);
    if (
      metadata.sessionId === sessionId &&
      (summary.title !== indexedSession.title || facts.messageCount !== indexedSession.messageCount)
    )
      failSummaryAudit(`session list and detail projections disagree: ${sessionId}`, report);
    const presentations = new Set();
    let detailBytes = 0;
    let thinkingDetailCount = 0;
    for (const message of summary.messages) {
      if (Object.hasOwn(message, "thinkingDetailRef"))
        failSummaryAudit(
          `immutable projection contains a legacy file reference: ${headFile}`,
          report,
        );
      if (message.role !== "assistant") continue;
      if (!message.presentationMessageId || presentations.has(message.presentationMessageId))
        failSummaryAudit(`invalid or duplicate presentation identity: ${headFile}`, report);
      presentations.add(message.presentationMessageId);
      if (!message.hasThinkingDetails) continue;
      const detail = await reader.readThinkingDetail({
        turnScopeId: message.turnScopeId,
        dialogProcessId: message.dialogProcessId,
      });
      if (
        !detail.exists ||
        detail.sessionId !== summary.sessionId ||
        detail.messageItem.presentationMessageId !== message.presentationMessageId ||
        !detail.messageItem.hasThinkingDetails
      )
        failSummaryAudit(`thinking detail identity or content mismatch: ${headFile}`, report);
      detailBytes += Buffer.byteLength(JSON.stringify(detail));
      thinkingDetailCount += 1;
    }
    const projectionBytes = Buffer.byteLength(JSON.stringify(summary));
    report.projectionBytes += projectionBytes;
    report.detailBytes += detailBytes;
    report.thinkingDetailCount += thinkingDetailCount;
    report.sessions.push({
      sessionId: summary.sessionId,
      generation: reader.generation,
      headFile: path.relative(root, headFile).replaceAll("\\", "/"),
      projectionBytes,
      detailBytes,
      messageCount: summary.messages.length,
      thinkingDetailCount,
    });
  }
  for (let index = 0; index < heads.length; index += 1) {
    if (!(await fs.readFile(heads[index])).equals(headVersions[index]))
      failSummaryAudit(`session changed during persistence audit: ${heads[index]}`, report);
  }
  return report;
}

export async function readSessionTurnMessages(userId, sessionId) {
  const session = await readSessionFact(userId, sessionId);
  return session.messages;
}

export async function readSnapshots(userId, sessionId) {
  const directory = path.join(await sessionRoot(userId, sessionId), "model-message-snapshots");
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readJson(path.join(directory, name))));
}

export function parseJsonLines(raw, { committedFramesOnly = false } = {}) {
  const source = String(raw || "");
  const lines = source.split(/\r?\n/);
  if (committedFramesOnly && source && !source.endsWith("\n")) lines.pop();
  return lines.filter(Boolean).map((line) => JSON.parse(line));
}

export async function readJsonLines(filePath, options = {}) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseJsonLines(raw, options);
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
  const eventsDir = path.join(await sessionRoot(userId, sessionId), "events");
  let names = [];
  try {
    names = (await fs.readdir(eventsDir)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return (
    await Promise.all(
      names.map((name) =>
        readJsonLinesIfPresent(path.join(eventsDir, name), { committedFramesOnly: true }),
      ),
    )
  ).flat();
}

async function listExecutionEventSegmentFiles(executionDir, { dialogProcessId = "" } = {}) {
  let index = null;
  try {
    index = JSON.parse(await fs.readFile(path.join(executionDir, "index.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const turn of Array.isArray(index?.turns) ? index.turns : []) {
    if (dialogProcessId && turn.dialogProcessId !== dialogProcessId) continue;
    const turnDir = path.join(executionDir, "turns", String(turn?.dialogProcessId || ""));
    const names = (await fs.readdir(turnDir))
      .filter((name) => /^segment-\d+\.jsonl$/.test(name))
      .sort();
    files.push(...names.map((name) => path.join(turnDir, name)));
  }
  return files;
}

export async function* iterateCommittedJsonLines(file) {
  let pending = "";
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop();
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}

async function* iterateExecutionEventSegmentFiles(files) {
  for (const file of files) yield* iterateCommittedJsonLines(file);
}

export async function* iterateSessionExecutionEvents(userId, sessionId, options = {}) {
  const executionDir = path.join(await sessionRoot(userId, sessionId), "execution-events");
  yield* iterateExecutionEventSegmentFiles(
    await listExecutionEventSegmentFiles(executionDir, options),
  );
}

export async function readSessionExecutionEvents(userId, sessionId, options = {}) {
  const records = [];
  for await (const record of iterateSessionExecutionEvents(userId, sessionId, options))
    records.push(record);
  return records;
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
      segments.push(...(await listExecutionEventSegmentFiles(child)));
      continue;
    }
    segments.push(...(await findExecutionEventSegments(child)));
  }
  return segments;
}

export async function readSessionExecutionEventTree(
  userId,
  sessionId,
  { rootSessionId = "" } = {},
) {
  const records = [];
  for await (const record of iterateSessionExecutionEventTree(userId, sessionId, { rootSessionId }))
    records.push(record);
  return records;
}

export async function* iterateSessionExecutionEventTree(
  userId,
  sessionId,
  { rootSessionId = "" } = {},
) {
  const normalizedSessionId = text(sessionId);
  const hasExplicitRoot = Boolean(text(rootSessionId));
  const normalizedRootSessionId = String(rootSessionId || normalizedSessionId).trim();
  if (!normalizedSessionId || !normalizedRootSessionId) return;

  const segments = (
    await Promise.all(
      (await sessionTreeRoots(userId, normalizedRootSessionId)).map((root) =>
        findExecutionEventSegments(root),
      ),
    )
  ).flat();
  for await (const record of iterateExecutionEventSegmentFiles(segments)) {
    if (!hasExplicitRoot || text(record?.sessionId) === normalizedSessionId) yield record;
  }
}

export function modelInvocationTraces(records) {
  return records.filter(
    (record) =>
      record.event === MODEL_CONTEXT_TRACE.EVENT &&
      record.data?.stage === MODEL_CONTEXT_TRACE.INVOKE_STAGE &&
      record.data?.authority === MODEL_CONTEXT_TRACE.INVOKE_AUTHORITY,
  );
}

export async function waitForSessionExecutionEventTree(
  userId,
  sessionId,
  predicate,
  { timeoutMs = PROTOCOL_TIMEOUTS.audit } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let records = [];
  while (Date.now() < deadline) {
    records = await readSessionExecutionEventTree(userId, sessionId);
    if (predicate(records)) return records;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `execution event tree did not converge for session ${sessionId}: ${JSON.stringify(records)}`,
  );
}

export async function waitForModelInvocationTraces(
  userId,
  sessionId,
  predicate,
  { timeoutMs = PROTOCOL_TIMEOUTS.model } = {},
) {
  let traces = [];
  await waitForSessionExecutionEventTree(
    userId,
    sessionId,
    (records) => {
      traces = modelInvocationTraces(records);
      return predicate(traces);
    },
    { timeoutMs },
  );
  return traces;
}

export async function readAttachmentIndex(userId, sessionId, attachmentSource) {
  return readJson(
    path.join(
      workspaceRoot(),
      userId,
      "runtime/attach/scoped",
      sessionId,
      attachmentSource,
      "attachments.json",
    ),
  );
}

async function findFileMutationRecords(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "file-mutations") {
        const names = (await fs.readdir(child, { withFileTypes: true }))
          .filter((item) => item.isFile() && item.name.endsWith(".json"))
          .map((item) => item.name)
          .sort();
        records.push(...(await Promise.all(names.map((name) => readJson(path.join(child, name))))));
      } else {
        records.push(...(await findFileMutationRecords(child)));
      }
    }
  }
  return records;
}

export async function readFileMutationRecords(userId, sessionId, { rootSessionId = "" } = {}) {
  const scopeId = String(rootSessionId || sessionId || "").trim();
  if (!scopeId) return [];
  return (
    await Promise.all(
      (await sessionTreeRoots(userId, scopeId)).map((root) => findFileMutationRecords(root)),
    )
  ).flat();
}

export async function waitForPluginRuntimeEvents(
  userId,
  sessionId,
  predicate,
  { timeoutMs = 15000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  while (Date.now() < deadline) {
    events = (await readSessionRuntimeEvents(userId, sessionId)).filter((record) =>
      String(record?.event || "").startsWith("plugin."),
    );
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `plugin runtime events did not converge for session ${sessionId}: ${JSON.stringify(events)}`,
  );
}

export async function waitForPluginExecutionEvents(
  userId,
  sessionId,
  predicate,
  { timeoutMs = 15000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  while (Date.now() < deadline) {
    events = (await readSessionExecutionEvents(userId, sessionId)).filter((record) =>
      String(record?.event || "").startsWith("plugin."),
    );
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `plugin execution events did not converge for session ${sessionId}: ${JSON.stringify(events)}`,
  );
}

export async function readPluginLogArtifacts(root, filename) {
  const parsed = path.parse(filename);
  const archives = (await fs.readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        isRotatedPluginLogName(entry.name, {
          name: parsed.name,
          extension: parsed.ext,
        }),
    )
    .map((entry) => entry.name)
    .sort();
  const records = [];
  for (const name of [...archives, filename]) {
    for await (const record of iterateCommittedJsonLines(path.join(root, name)))
      records.push(record);
  }
  return records;
}

function harnessRunRoot(userId, dialogProcessId) {
  return path.join(workspaceRoot(), userId, "runtime/plugin-data/harness/runs", dialogProcessId);
}

export async function readHarnessContext(userId, dialogProcessId) {
  return readJson(path.join(harnessRunRoot(userId, dialogProcessId), "context-snapshot.json"));
}

export async function readHarnessRun(userId, dialogProcessId) {
  const root = harnessRunRoot(userId, dialogProcessId);
  return {
    run: await readJson(path.join(root, "harness-run.json")),
    events: await readPluginLogArtifacts(root, "events.jsonl"),
    capabilityTraces: await readJsonLinesIfPresent(path.join(root, "capability-traces.jsonl")),
  };
}

export async function waitForHarnessRun(
  userId,
  dialogProcessId,
  predicate,
  { timeoutMs = PROTOCOL_TIMEOUTS.harness } = {},
) {
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
  throw new Error(
    `Harness run did not converge for dialog ${dialogProcessId}: ${JSON.stringify(run)}`,
  );
}
