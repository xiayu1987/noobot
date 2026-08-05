/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(process.argv.find((arg) => arg.startsWith("--workspace="))?.slice(12) || "workspace");
const write = process.argv.includes("--write");
const backupRoot = process.argv.find((arg) => arg.startsWith("--backup="))?.slice(9);
if (write && !backupRoot) throw new Error("--write requires --backup=<directory>");

const candidates = [];
function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.name === "session.json" || entry.name === "session-summary.json" || (entry.name.endsWith(".jsonl") && path.basename(path.dirname(absolute)) === "turns")) candidates.push(absolute);
  }
}
visit(workspaceRoot);

function messageUid(message, sessionId, index) {
  if (String(message?.messageUid || "").trim()) return message.messageUid;
  const seed = JSON.stringify([sessionId, message?.dialogProcessId, message?.turnScopeId, message?.messageId, index]);
  return `sm_migrated_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}

function isPresentationProjection(message = {}) {
  return message.chatPresentation === true
    && Boolean(String(message.presentationMessageId || "").trim())
    && Boolean(String(message.sourceMessageUid || "").trim());
}

function migrateMessage(message = {}, sessionId = "", index = 0) {
  const next = { ...message };
  if (isPresentationProjection(message)) delete next.messageUid;
  else next.messageUid = messageUid(message, sessionId, index);
  if (next.injectedMessageType === undefined && next.injected_message_type !== undefined) next.injectedMessageType = next.injected_message_type;
  delete next.injected_message_type;
  if (next.turnCommit && typeof next.turnCommit === "object") {
    next.turnCommit = { ...next.turnCommit, commandId: next.turnCommit.commandId || next.turnCommit.idempotencyKey };
    delete next.turnCommit.idempotencyKey;
  }
  return next;
}

function migrateDocument(document = {}) {
  const next = structuredClone(document);
  const sessionId = String(next.sessionId || "").trim();
  if ("version" in next || "revision" in next) {
    next.aggregateVersion = Math.max(0, Number(next.aggregateVersion || next.version || next.revision) || 0);
    delete next.version;
    delete next.revision;
  }
  if (Array.isArray(next.messages)) next.messages = next.messages.map((message, index) => migrateMessage(message, sessionId, index));
  if (Array.isArray(next.mutationReceipts)) {
    next.mutationReceipts = next.mutationReceipts.map((receipt) => {
      const migrated = {
        ...receipt,
        commandId: receipt.commandId || receipt.idempotencyKey,
        aggregateVersion: Number(receipt.aggregateVersion || receipt.version || 0),
      };
      delete migrated.idempotencyKey;
      delete migrated.version;
      return migrated;
    });
  }
  const replacementDialogProcessId = (replacement = {}) => {
    const replacementTurnScopeId = String(replacement.replacementTurnScopeId || "").trim();
    const replacementUserMessageId = String(replacement.replacementUserMessageId || "").trim();
    const message = (Array.isArray(next.messages) ? next.messages : []).find((item = {}) => (
      String(item.messageId || item.id || item.messageUid || "").trim() === replacementUserMessageId
    ));
    const turn = (Array.isArray(next.turnOrder) ? next.turnOrder : []).find((item = {}) => (
      String(item.turnScopeId || "").trim() === replacementTurnScopeId
    ));
    const resolved = String(message?.dialogProcessId || turn?.dialogProcessId || "").trim();
    if (!resolved) {
      throw new TypeError(
        `cannot migrate replacement dialog identity for session ${sessionId}, turn ${replacementTurnScopeId}`,
      );
    }
    return resolved;
  };
  for (const replacement of Object.values(next.turnLifecycle?.replacedTurns || {})) {
    replacement.committedAggregateVersion = Number(replacement.committedAggregateVersion || replacement.committedVersion || 0);
    replacement.replacementDialogProcessId = replacement.replacementDialogProcessId
      || replacementDialogProcessId(replacement);
    delete replacement.committedVersion;
  }
  for (const receipt of Array.isArray(next.mutationReceipts) ? next.mutationReceipts : []) {
    const replacement = receipt?.result?.turnReplacement;
    if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) continue;
    replacement.committedAggregateVersion = Number(
      replacement.committedAggregateVersion || replacement.committedVersion || 0,
    );
    replacement.replacementDialogProcessId = replacement.replacementDialogProcessId
      || replacementDialogProcessId(replacement);
    delete replacement.committedVersion;
  }
  delete next.turnTerminalCommits;
  return next;
}

let changed = 0;
for (const file of candidates) {
  const original = fs.readFileSync(file, "utf8");
  const trailingNewline = original.endsWith("\n");
  const documents = file.endsWith(".jsonl")
    ? original.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [JSON.parse(original)];
  const migrated = documents.map(migrateDocument);
  const output = file.endsWith(".jsonl")
    ? `${migrated.map((value) => JSON.stringify(value)).join("\n")}${trailingNewline ? "\n" : ""}`
    : `${JSON.stringify(migrated[0], null, 2)}${trailingNewline ? "\n" : ""}`;
  if (output === original) continue;
  changed += 1;
  if (!write) continue;
  const relative = path.relative(workspaceRoot, file);
  const backup = path.resolve(backupRoot, relative);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  const temporary = `${file}.session-v1-${process.pid}.tmp`;
  fs.writeFileSync(temporary, output);
  fs.renameSync(temporary, file);
}

console.log(JSON.stringify({ workspaceRoot, filesScanned: candidates.length, filesChanged: changed, written: write }));
