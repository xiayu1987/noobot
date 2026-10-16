/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { migrateSessionDocument } from "@noobot/session-repair";
import { parseMigrationArgs } from "./lib/migration-cli.mjs";

const { workspaceRoot, write, backupRoot } = parseMigrationArgs();

const candidates = [];
function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.name === "session.json") candidates.push(absolute);
  }
}
visit(workspaceRoot);

let changed = 0;
for (const file of candidates) {
  const original = fs.readFileSync(file, "utf8");
  const trailingNewline = original.endsWith("\n");
  const sessionId = path.basename(path.dirname(file));
  const migrated = migrateSessionDocument(JSON.parse(original), { sessionId }).document;
  const output = `${JSON.stringify(migrated, null, 2)}${trailingNewline ? "\n" : ""}`;
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

console.log(
  JSON.stringify({
    workspaceRoot,
    filesScanned: candidates.length,
    filesChanged: changed,
    written: write,
  }),
);
