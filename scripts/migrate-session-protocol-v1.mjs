/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { migrateSessionDocument } from "@noobot/session-repair";

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

let changed = 0;
for (const file of candidates) {
  const original = fs.readFileSync(file, "utf8");
  const trailingNewline = original.endsWith("\n");
  const documents = file.endsWith(".jsonl")
    ? original.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [JSON.parse(original)];
  const sessionDirectory = path.basename(path.dirname(file)) === "turns"
    ? path.dirname(path.dirname(file))
    : path.dirname(file);
  const sessionId = path.basename(sessionDirectory);
  const migrated = documents.map((document) => migrateSessionDocument(document, { sessionId }).document);
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
