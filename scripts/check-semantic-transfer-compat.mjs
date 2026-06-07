#!/usr/bin/env node
/*
 * semantic-transfer compatibility guard
 *
 * Goal:
 * - Keep legacy transfer compatibility fields from spreading to new files.
 * - Existing compatibility/migration files are explicitly allowlisted.
 * - Overflow legacy fields must be generated only by semantic-transfer legacy adapter.
 *
 * This is intentionally a source-level guard, not a semantic JS parser. If a
 * legitimate new compatibility site is added, add the file to the allowlist
 * with a short reason in this script.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["agent/src", "plugin", "client/noobot-chat/src"];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}tests${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}generated${path.sep}`,
];

const LEGACY_FIELD_REGEXES = [
  { field: "attachmentMetas", regex: /(^|[,{(\s])attachmentMetas\s*:/ },
  { field: "attachmentMeta", regex: /(^|[,{(\s])attachmentMeta\s*:/ },
  { field: "filePath", regex: /(^|[,{(\s])filePath\s*:/ },
  { field: "filePaths", regex: /(^|[,{(\s])filePaths\s*:/ },
];

const OVERFLOW_FIELD_REGEXES = [
  { field: "overflow_file_path", regex: /overflow_file_path/ },
  { field: "overflow_file_sandbox_path", regex: /overflow_file_sandbox_path/ },
];

const OVERFLOW_ALLOWED_FILES = new Set([
  "agent/src/system-core/semantic-transfer/legacy-adapter.js",
]);

// Files that intentionally bridge semantic-transfer with legacy attachment/file
// fields, or define existing public message/runtime contracts that still carry
// attachmentMetas as a compatibility field.
const LEGACY_FIELD_ALLOWED_FILES = new Map(Object.entries({
  "agent/src/system-core/agent/core/context/message-builder.js": "model context compatibility consumes runtime attachmentMetas",
  "agent/src/system-core/agent/core/execution/tool-runner.js": "tool overflow builds TransferEnvelope then legacy overflow via adapter",
  "agent/src/system-core/agent/core/media/artifact-service.js": "artifact extraction compatibility reads legacy + transfer",
  "agent/src/system-core/attach/meta-ops.js": "legacy attachment meta normalization utility",
  "agent/src/system-core/attach/runtime-attachment.js": "runtime attachment legacy store",
  "agent/src/system-core/attach/service/attachment-service.js": "attachment service rewrites persisted message metas",
  "agent/src/system-core/bot-manage/execution/runner.js": "session runner attachment compatibility",
  "agent/src/system-core/bot-manage/execution/turn-persister.js": "turn persistence legacy schema",
  "agent/src/system-core/bot-manage/session/session-execution-engine.js": "session execution legacy bridge",
  "agent/src/system-core/connectors/emails/read-email.js": "email connector legacy bridge",
  "agent/src/system-core/context/builders/runtime-environment-builder.js": "runtime environment exposes semantic-transfer helpers and legacy metas",
  "agent/src/system-core/context/index.js": "context builder public attachment contract",
  "agent/src/system-core/context/session/message-converter.js": "replay compatibility preserves legacy fields",
  "agent/src/system-core/semantic-transfer/attachment-adapter.js": "semantic-transfer adapter derives legacy fields centrally",
  "agent/src/system-core/semantic-transfer/consumer.js": "semantic-transfer consumer accepts legacy fallback",
  "agent/src/system-core/semantic-transfer/legacy-adapter.js": "central legacy compatibility adapter",
  "agent/src/system-core/semantic-transfer/normalizer.js": "semantic-transfer normalizes legacy fallback",
  "agent/src/system-core/semantic-transfer/path-resolver.js": "semantic-transfer path resolver compatibility",
  "agent/src/system-core/tools/ai-models/multimodal-generate-tool.js": "tool output keeps legacy fallback from semantic-transfer",
  "agent/src/system-core/tools/connectors/connector-toolkit/tool-access-connector.js": "connector output keeps legacy fallback from semantic-transfer",
  "agent/src/system-core/tools/core/check-tool-input.js": "tool input schema/error details use filePath as user field",
  "agent/src/system-core/tools/data-processing/doc2data-tool.js": "tool input/output compatibility",
  "agent/src/system-core/tools/data-processing/media2data-tool.js": "tool input/output compatibility",
  "agent/src/system-core/tools/data-processing/web2data-tool.js": "tool input path schema",
  "agent/src/system-core/tools/execution/file-tool.js": "file tool public input schema",
  "agent/src/system-core/tools/workflow/agent-collab/collab-artifact-persist.js": "agent-collab output keeps legacy fallback from semantic-transfer",
  "agent/src/system-core/tools/workflow/agent-collab/collab-task-utils.js": "agent-collab payload compatibility",
  "agent/src/system-core/tools/workflow/agent-collab/tool-wait-async-result.js": "agent-collab wait result compatibility",

  "client/noobot-chat/src/composables/infra/messageModel.js": "frontend message model keeps legacy fallback but consumes transfer first",
  "client/noobot-chat/src/composables/infra/transferEnvelope.js": "frontend semantic-transfer adapter maps envelope files to legacy display metas",

  "plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/output-finalizer.js": "harness final output legacy fallback with transfer payload",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/controller.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/model-runner.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/planning/refinement-runner.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/attachment-log-utils.js": "harness central compatibility helper",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/message/injection-utils.js": "harness injected message compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/sandbox-path.js": "harness path block compatibility",

  "plugin/noobot-plugin-workflow/src/core/hooks.js": "workflow payload keeps transfer fields with legacy fallback",
}));

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (IGNORE_PATH_PARTS.some((part) => full.includes(part))) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function isCommentOrImportLine(line = "") {
  const text = String(line || "").trim();
  return (
    !text ||
    text.startsWith("//") ||
    text.startsWith("*") ||
    text.startsWith("/*") ||
    text.startsWith("import ") ||
    text.startsWith("export {") ||
    text.includes(" from ")
  );
}

function detectFile(file) {
  const rel = toPosix(path.relative(ROOT, file));
  const raw = readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const violations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCommentOrImportLine(line)) continue;

    for (const item of OVERFLOW_FIELD_REGEXES) {
      if (!item.regex.test(line)) continue;
      if (OVERFLOW_ALLOWED_FILES.has(rel)) continue;
      violations.push({
        type: "overflow",
        field: item.field,
        file: rel,
        line: index + 1,
        text: line.trim(),
        hint: "Use buildLegacyOverflowFields() from semantic-transfer/legacy-adapter instead of spelling overflow legacy fields.",
      });
    }

    for (const item of LEGACY_FIELD_REGEXES) {
      if (!item.regex.test(line)) continue;
      if (LEGACY_FIELD_ALLOWED_FILES.has(rel)) continue;
      violations.push({
        type: "legacy-field",
        field: item.field,
        file: rel,
        line: index + 1,
        text: line.trim(),
        hint: "New transfer-producing code should emit TransferEnvelope/TransferResult and derive legacy fields through semantic-transfer adapters, or add an explicit allowlist reason here.",
      });
    }
  }
  return violations;
}

function run() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    const full = path.join(ROOT, dir);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(full, files);
  }

  const violations = files.flatMap(detectFile);
  if (!violations.length) {
    console.log("[semantic-transfer-compat] OK");
    return;
  }

  console.error(`[semantic-transfer-compat] Found ${violations.length} potential legacy transfer compatibility violation(s):`);
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} [${item.type}:${item.field}] ${item.text}`);
    console.error(`  ${item.hint}`);
  }
  process.exitCode = 1;
}

run();
