#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { requireDialogProcessKey } from "@noobot/session-protocol";
import {
  buildExecutionReport,
  decodeExecutionReport,
  EXECUTION_REPORT_VERSION,
} from "@noobot/session-protocol/execution-report";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import {
  SNAPSHOT_MANIFEST_FILE,
  appendRollingJsonlArtifactLog,
  buildSessionArtifactFileMap,
  iterateExecutionLogs,
  listExecutionEventTurns,
  readExecutionLogs,
  readSessionArtifactSnapshot,
  writeSessionArtifactSnapshotCommit,
} from "../agent/src/session/session-artifact-store.js";
import { summarizeExecutionLogs } from "../agent/src/observability/execution-log/execution-log-summary.js";

const EVENTS_DIR = "execution-events";
const REPORTS_DIR = "execution-reports";
const LEGACY_EXECUTION_FILE = "execution.json";
const STAGING_DIR = ".execution-events-v2-staging";
const RETIRED_DIR = ".execution-events-v1-retired";
const SNAPSHOT_SESSION_FILE = path.basename(buildSessionArtifactFileMap("/").session);

function argument(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const workspaceRoot = path.resolve(argument("workspace") || "workspace");
const write = process.argv.includes("--write");
const backupRoot = argument("backup");
if (write && !backupRoot) throw new Error("--write requires --backup=<directory>");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findSessionDirs(directory, found = new Set()) {
  if (!fs.existsSync(directory)) return found;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === LEGACY_EXECUTION_FILE && entry.isFile()) found.add(directory);
    if (entry.name === SNAPSHOT_SESSION_FILE && entry.isFile()) found.add(directory);
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    if (entry.name === EVENTS_DIR || entry.name === REPORTS_DIR) {
      found.add(directory);
      continue;
    }
    findSessionDirs(path.join(directory, entry.name), found);
  }
  return found;
}

function readLegacyEventIndex(sessionDir) {
  const indexFile = path.join(sessionDir, EVENTS_DIR, "index.json");
  if (!fs.existsSync(indexFile)) return null;
  const index = readJson(indexFile);
  return !Array.isArray(index.turns) && Array.isArray(index.segments) ? index : null;
}

function listLegacyReports(sessionDir) {
  const reportsDir = path.join(sessionDir, REPORTS_DIR);
  if (!fs.existsSync(reportsDir)) return [];
  return fs
    .readdirSync(reportsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file: path.join(reportsDir, file),
      report: readJson(path.join(reportsDir, file)),
    }))
    .filter(({ report }) => report.version !== EXECUTION_REPORT_VERSION)
    .map((entry) => {
      const dialogProcessId = requireDialogProcessKey(entry.report.dialogProcessId);
      if (path.basename(entry.file) !== `${dialogProcessId}.json`) {
        throw new Error(`report file does not match its dialogProcessId: ${entry.file}`);
      }
      return { ...entry, dialogProcessId };
    });
}

async function* iterateLegacyRecords(eventsDir, index) {
  for (const segment of index.segments) {
    const file = String(segment?.file || "");
    if (!file || file.includes("/") || file.includes("\\") || file.includes("..")) {
      throw new Error(`invalid legacy segment reference in ${eventsDir}: ${file}`);
    }
    const lines = readline.createInterface({
      input: fs.createReadStream(path.join(eventsDir, file), { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

async function fingerprintTurns(records) {
  const turns = new Map();
  for await (const record of records) {
    const key = requireDialogProcessKey(record?.dialogProcessId);
    const turn = turns.get(key) || { records: 0, hash: createHash("sha256") };
    turn.records += 1;
    turn.hash.update(`${JSON.stringify(record)}\n`);
    turns.set(key, turn);
  }
  return new Map(
    [...turns].map(([key, turn]) => [key, `${turn.records}:${turn.hash.digest("hex")}`]),
  );
}

async function verifyStaged(stagingSessionDir, expected) {
  const actual = await fingerprintTurns(iterateExecutionLogs(stagingSessionDir));
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    if (expected.get(key) !== actual.get(key)) {
      throw new Error(
        `turn ${key} mismatch: expected ${expected.get(key)}, got ${actual.get(key)}`,
      );
    }
  }
}

async function migrateEvents(sessionDir, legacyIndex, expected) {
  const eventsDir = path.join(sessionDir, EVENTS_DIR);
  const stagingSessionDir = path.join(sessionDir, STAGING_DIR);
  fs.rmSync(stagingSessionDir, { recursive: true, force: true });
  fs.mkdirSync(stagingSessionDir, { recursive: true });
  for await (const log of iterateLegacyRecords(eventsDir, legacyIndex)) {
    await appendRollingJsonlArtifactLog({
      sessionDir: stagingSessionDir,
      log,
      maxSegmentBytes: Number(legacyIndex.maxSegmentBytes) || undefined,
      alreadyLocked: true,
    });
  }
  await verifyStaged(stagingSessionDir, expected);
  const retired = path.join(sessionDir, RETIRED_DIR);
  fs.rmSync(retired, { recursive: true, force: true });
  fs.renameSync(eventsDir, retired);
  fs.renameSync(path.join(stagingSessionDir, EVENTS_DIR), eventsDir);
  fs.rmSync(stagingSessionDir, { recursive: true, force: true });
  fs.rmSync(retired, { recursive: true, force: true });
}

async function rebuildReport(sessionDir, { file, report: legacy, dialogProcessId }) {
  const recorded = (await listExecutionEventTurns(sessionDir)).some(
    (turn) => turn.dialogProcessId === dialogProcessId,
  );
  const logs = recorded ? await readExecutionLogs(sessionDir, { dialogProcessId }) : null;
  const report = buildExecutionReport({
    status: legacy.status,
    sessionId: legacy.sessionId,
    parentSessionId: legacy.parentSessionId,
    dialogProcessId,
    turnScopeId: legacy.turnScopeId,
    caller: legacy.caller,
    startedAt: legacy.startedAt,
    finishedAt: legacy.finishedAt,
    executionSummary: logs ? summarizeExecutionLogs(logs) : null,
    summaryError: logs
      ? null
      : {
          name: "Error",
          code: "EXECUTION_LOGS_UNAVAILABLE",
          message: "turn has no execution logs",
        },
    error: legacy.error,
  });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, file);
  decodeExecutionReport(readJson(file));
  return Boolean(logs);
}

function readUncommittedSnapshotSessionId(sessionDir) {
  const relative = path.relative(workspaceRoot, sessionDir).split(path.sep);
  const pluginDataSegments = WORKSPACE_LAYOUT.PLUGIN_DATA_DIR.split("/");
  const underPluginData = pluginDataSegments.every(
    (segment, index) => relative[index + 1] === segment,
  );
  if (!underPluginData) return null;
  if (fs.existsSync(path.join(sessionDir, SNAPSHOT_MANIFEST_FILE))) return null;
  const sessionFile = path.join(sessionDir, SNAPSHOT_SESSION_FILE);
  if (!fs.existsSync(sessionFile)) return null;
  const sessionId = String(readJson(sessionFile).sessionId || "").trim();
  if (!sessionId) throw new Error(`snapshot session.json has no sessionId: ${sessionDir}`);
  return sessionId;
}

function backupSession(sessionDir, { legacyIndex, reports, executionFile }) {
  const backupDir = path.resolve(backupRoot, path.relative(workspaceRoot, sessionDir));
  if (fs.existsSync(backupDir)) throw new Error(`backup already exists: ${backupDir}`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (legacyIndex) {
    fs.cpSync(path.join(sessionDir, EVENTS_DIR), path.join(backupDir, EVENTS_DIR), {
      recursive: true,
    });
  }
  for (const { file } of reports) {
    fs.mkdirSync(path.join(backupDir, REPORTS_DIR), { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, REPORTS_DIR, path.basename(file)));
  }
  if (executionFile) {
    fs.copyFileSync(executionFile, path.join(backupDir, LEGACY_EXECUTION_FILE));
  }
  return backupDir;
}

async function migrateSession(sessionDir) {
  const legacyIndex = readLegacyEventIndex(sessionDir);
  const reports = listLegacyReports(sessionDir);
  const executionFilePath = path.join(sessionDir, LEGACY_EXECUTION_FILE);
  const executionFile = fs.existsSync(executionFilePath) ? executionFilePath : "";
  const snapshotSessionId = readUncommittedSnapshotSessionId(sessionDir);
  if (!legacyIndex && !reports.length && !executionFile && !snapshotSessionId) return null;
  const expected = legacyIndex
    ? await fingerprintTurns(iterateLegacyRecords(path.join(sessionDir, EVENTS_DIR), legacyIndex))
    : new Map();
  const summary = {
    sessionDir: path.relative(workspaceRoot, sessionDir),
    segments: legacyIndex ? legacyIndex.segments.length : 0,
    records: [...expected.values()].reduce((sum, value) => sum + Number.parseInt(value, 10), 0),
    turns: expected.size,
    reports: reports.length,
    executionFile: Boolean(executionFile),
    snapshotCommit: Boolean(snapshotSessionId),
  };
  if (!write) return summary;

  const backup = backupSession(sessionDir, { legacyIndex, reports, executionFile });
  if (legacyIndex) await migrateEvents(sessionDir, legacyIndex, expected);
  let reportsWithoutLogs = 0;
  for (const entry of reports) {
    if (!(await rebuildReport(sessionDir, entry))) reportsWithoutLogs += 1;
  }
  if (executionFile) fs.rmSync(executionFile);
  if (snapshotSessionId) {
    await writeSessionArtifactSnapshotCommit({
      outputDir: sessionDir,
      sessionId: snapshotSessionId,
      committedAt: new Date().toISOString(),
    });
    await readSessionArtifactSnapshot({ outputDir: sessionDir, includeExecutionLogs: false });
  }
  return { ...summary, reportsWithoutLogs, backup };
}

const migrated = [];
for (const sessionDir of [...findSessionDirs(workspaceRoot)].sort()) {
  const result = await migrateSession(sessionDir);
  if (result) migrated.push(result);
}

const total = (field) => migrated.reduce((sum, item) => sum + Number(item[field] || 0), 0);
console.log(
  JSON.stringify({
    workspaceRoot,
    legacySessions: migrated.length,
    records: total("records"),
    reports: total("reports"),
    reportsWithoutLogs: total("reportsWithoutLogs"),
    executionFiles: migrated.filter((item) => item.executionFile).length,
    snapshotCommits: migrated.filter((item) => item.snapshotCommit).length,
    written: write,
    sessions: migrated,
  }),
);
