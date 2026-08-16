#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_RECORD_SCHEMA,
  ATTACHMENT_RECORD_VERSION,
  ATTACHMENT_RELATION_TYPE,
  parsePersistedAttachmentRecord,
} from "@noobot/attachment-protocol";

const workspaceRoot = path.resolve(
  process.argv.find((argument) => argument.startsWith("--workspace="))?.slice(12) || "workspace",
);
const write = process.argv.includes("--write");
const backupRootArgument = process.argv
  .find((argument) => argument.startsWith("--backup="))
  ?.slice(9);
const backupRoot = backupRootArgument ? path.resolve(backupRootArgument) : "";
if (write && !backupRoot) throw new Error("--write requires --backup=<directory>");

function collectIndexFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectIndexFiles(absolute, output);
    else if (entry.isFile() && entry.name === "attachments.json") output.push(absolute);
  }
  return output;
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function legacyIdentity(record, scope) {
  return (
    record?.identity || {
      attachmentId: record?.attachmentId,
      sessionId: record?.sessionId || scope.sessionId,
      attachmentSource: record?.attachmentSource || scope.attachmentSource,
    }
  );
}

function identityLookupKey({ sessionId, attachmentId }) {
  return JSON.stringify([String(sessionId || "").trim(), String(attachmentId || "").trim()]);
}

function buildIdentityRegistry(indexSources) {
  const registry = new Map();
  for (const { file, source } of indexSources) {
    const scope = {
      sessionId: String(source?.sessionId || "").trim(),
      attachmentSource: String(source?.attachmentSource || "").trim(),
    };
    if (!scope.sessionId || !scope.attachmentSource) {
      throw new Error(`invalid_attachment_index_scope:${file}`);
    }
    for (const record of Object.values(source?.attachments || {})) {
      const identity = legacyIdentity(record, scope);
      if (
        identity.sessionId !== scope.sessionId ||
        identity.attachmentSource !== scope.attachmentSource
      ) {
        throw new Error(`attachment_index_scope_mismatch:${file}`);
      }
      const key = identityLookupKey(identity);
      const existing = registry.get(key);
      if (existing && existing.attachmentSource !== identity.attachmentSource) {
        throw new Error(`ambiguous_legacy_attachment_identity:${key}`);
      }
      registry.set(key, identity);
    }
  }
  return registry;
}

function migrateRelation(record, identity, identityRegistry) {
  const parsedResult = record?.parsedResult;
  if (!parsedResult || typeof parsedResult !== "object" || Array.isArray(parsedResult)) return [];
  const targetAttachmentId = String(parsedResult.attachmentId || "").trim();
  const createdAt = String(
    parsedResult.updatedAt || record.updatedAt || record.createdAt || "",
  ).trim();
  if (!targetAttachmentId || !createdAt) throw new Error("invalid_legacy_parsed_result");
  const targetIdentity = identityRegistry.get(
    identityLookupKey({
      sessionId: identity.sessionId,
      attachmentId: targetAttachmentId,
    }),
  );
  if (!targetIdentity) throw new Error("legacy_parsed_result_target_missing");
  return [
    definedEntries({
      relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
      sourceIdentity: identity,
      targetIdentity,
      name: String(parsedResult.name || "").trim() || undefined,
      mimeType: String(parsedResult.mimeType || "").trim() || undefined,
      size:
        Number.isSafeInteger(parsedResult.size) && parsedResult.size >= 0
          ? parsedResult.size
          : undefined,
      storageRef: String(parsedResult.relativePath || "").trim()
        ? { kind: "attachment-store", ref: String(parsedResult.relativePath).trim() }
        : undefined,
      producer: String(parsedResult.tool || "").trim()
        ? { type: "tool", id: String(parsedResult.tool).trim() }
        : undefined,
      createdAt,
    }),
  ];
}

function migrateRecord(record, scope, identityRegistry) {
  if (record?.schema === ATTACHMENT_RECORD_SCHEMA) {
    return parsePersistedAttachmentRecord(record);
  }
  const identity = legacyIdentity(record, scope);
  const sourceDescriptor = record?.descriptor || record;
  const createdAt = String(record?.createdAt || "").trim();
  const updatedAt = String(record?.updatedAt || createdAt).trim();
  const storageRef = record?.storageRef || {
    kind: "attachment-store",
    ref: String(record?.relativePath || "").trim(),
  };
  return parsePersistedAttachmentRecord({
    schema: ATTACHMENT_RECORD_SCHEMA,
    version: ATTACHMENT_RECORD_VERSION,
    identity,
    descriptor: definedEntries({
      identity,
      clientAttachmentId: String(sourceDescriptor?.clientAttachmentId || "").trim() || undefined,
      name: String(sourceDescriptor?.name || "").trim(),
      mimeType: String(sourceDescriptor?.mimeType || "").trim(),
      size:
        Number.isSafeInteger(sourceDescriptor?.size) && sourceDescriptor.size >= 0
          ? sourceDescriptor.size
          : undefined,
      contentSha256: String(sourceDescriptor?.contentSha256 || "").trim() || undefined,
      owner: sourceDescriptor?.owner,
      generationSource: String(sourceDescriptor?.generationSource || "").trim() || undefined,
      generatedByModel:
        typeof sourceDescriptor?.generatedByModel === "boolean"
          ? sourceDescriptor.generatedByModel
          : undefined,
    }),
    storageRef,
    relations: Array.isArray(record?.relations)
      ? record.relations
      : migrateRelation(record, identity, identityRegistry),
    createdAt,
    updatedAt,
  });
}

function migrateIndex(file, source, identityRegistry) {
  const scope = {
    sessionId: String(source?.sessionId || "").trim(),
    attachmentSource: String(source?.attachmentSource || "").trim(),
  };
  if (!scope.sessionId || !scope.attachmentSource)
    throw new Error(`invalid_attachment_index_scope:${file}`);
  const attachments = {};
  for (const [attachmentId, record] of Object.entries(source?.attachments || {})) {
    const migrated = migrateRecord(record, scope, identityRegistry);
    if (migrated.identity.attachmentId !== attachmentId) {
      throw new Error(`attachment_index_key_mismatch:${file}:${attachmentId}`);
    }
    attachments[attachmentId] = migrated;
  }
  return { ...source, attachments };
}

const files = collectIndexFiles(workspaceRoot);
const indexSources = files.map((file) => ({
  file,
  source: JSON.parse(fs.readFileSync(file, "utf8")),
}));
const identityRegistry = buildIdentityRegistry(indexSources);
const migrations = indexSources.map(({ file, source }) => {
  const original = fs.readFileSync(file, "utf8");
  const migrated = `${JSON.stringify(migrateIndex(file, source, identityRegistry), null, 2)}\n`;
  return { file, original, migrated, changed: original !== migrated };
});
const changed = migrations.filter((migration) => migration.changed);

if (write) {
  for (const migration of changed) {
    const relative = path.relative(workspaceRoot, migration.file);
    const backup = path.resolve(backupRoot, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(migration.file, backup, fs.constants.COPYFILE_EXCL);
    const temporary = `${migration.file}.attachment-v1-${process.pid}.tmp`;
    fs.writeFileSync(temporary, migration.migrated);
    fs.renameSync(temporary, migration.file);
  }
}

console.log(
  JSON.stringify({
    workspaceRoot,
    filesScanned: files.length,
    filesChanged: changed.length,
    recordsMigrated: changed.reduce(
      (total, migration) =>
        total + Object.keys(JSON.parse(migration.migrated).attachments || {}).length,
      0,
    ),
    written: write,
  }),
);
