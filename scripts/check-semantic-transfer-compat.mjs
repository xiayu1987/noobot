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

// Out-of-scope attachment-save paths that have already been moved back to
// attachmentService. Keep them closed so semantic-transfer does not regress
// into a generic attachment persistence layer.
const SETTLED_ATTACHMENT_SERVICE_ONLY_FILES = new Map(Object.entries({
  "agent/src/system-core/bot-manage/session/scoped-artifact-persistence-helpers.js":
    "generic generated artifacts must use attachmentService.ingestGeneratedArtifacts",
  "agent/src/system-core/agent/core/media/artifact-service.js":
    "LLM output media attachment persistence must use attachmentService.ingestGeneratedArtifacts",
  "agent/src/system-core/tools/ai-models/multimodal-generate-tool.js":
    "multimodal image generation attachment persistence must use attachmentService.ingestGeneratedArtifacts",
  "agent/src/system-core/tools/connectors/connector-toolkit/tool-access-connector.js":
    "email connector attachment persistence must use attachmentService.ingestGeneratedArtifacts",
  "agent/src/system-core/tools/collaboration/agent-collab/collab-artifact-persist.js":
    "ordinary agent-collab async result attachment persistence must use attachmentService.ingestGeneratedArtifacts",
}));


const REMOVED_PUBLIC_WRAPPER_REGEXES = [
  { api: "transferSemanticContentSync", regex: /\btransferSemanticContentSync\b/ },
  { api: "transferToolMessage", regex: /\btransferToolMessage\b/ },
  { api: "transferSubAgentMessages", regex: /\btransferSubAgentMessages\b/ },
  { api: "processStageMessage", regex: /\bprocessStageMessage\b/ },
  { api: "composeFinalMessage", regex: /\bcomposeFinalMessage\b/ },
];

const REMOVED_PUBLIC_WRAPPER_ALLOWED_FILES = new Set();

const OUT_OF_SCOPE_SEMANTIC_TRANSFER_REGEXES = [
  { api: "transferSemanticContent", regex: /\btransferSemanticContent\b/ },
  { api: "semanticTransfer", regex: /\bsemanticTransfer\b/ },
  { api: "noobot.semantic-transfer", regex: /noobot\.semantic-transfer/ },
  { api: "persistTransferArtifacts", regex: /\bpersistTransferArtifacts\b/ },
  { api: "persistTransferFile", regex: /\bpersistTransferFile\b/ },
  { api: "materializeOutputResult", regex: /\bmaterializeOutputResult\b/ },
  { api: "materializeOutput", regex: /\bmaterializeOutput\b/ },
];

// Files that intentionally bridge semantic-transfer with legacy attachment/file
// fields, or define existing public message/runtime contracts that still carry
// attachmentMetas as a compatibility field.
const LEGACY_FIELD_ALLOWED_FILES = new Map(Object.entries({
  "agent/src/system-core/agent/core/context/message-builder.js": "model context compatibility consumes runtime attachmentMetas",
  "agent/src/system-core/agent/core/execution/tool-runner.js": "tool overflow builds TransferEnvelope then legacy overflow via adapter",
  "agent/src/system-core/agent/core/execution/state-committer.js": "runtime/turn event stream still emits attachmentMetas for existing consumers",
  "agent/src/system-core/agent/core/media/artifact-service.js": "artifact extraction compatibility reads legacy + transfer",
  "agent/src/system-core/attach/meta-ops.js": "legacy attachment meta normalization utility",
  "agent/src/system-core/attach/runtime-attachment.js": "runtime attachment legacy store",
  "agent/src/system-core/attach/service/attachment-service.js": "attachment service rewrites persisted message metas",
  "agent/src/system-core/bot-manage/execution/runner.js": "session runner attachment compatibility",
  "agent/src/system-core/bot-manage/execution/finalizer.js": "final assistant aggregation keeps attachmentMetas compatibility for persisted turn schema",
  "agent/src/system-core/bot-manage/execution/turn-persister.js": "turn persistence legacy schema",
  "agent/src/system-core/bot-manage/session/session-execution-engine.js": "session execution legacy bridge",
  "agent/src/system-core/bot-manage/session/detached-subsession-runner.js": "detached sub-session runner still accepts/publishes attachmentMetas in session snapshot compatibility contract",
  "agent/src/system-core/session/services/session-message-service.js": "session message service keeps attachmentMetas compatibility for persisted/runtime message contracts",
  "agent/src/system-core/connectors/emails/read-email.js": "email connector legacy bridge",
  "agent/src/system-core/context/builders/runtime-environment-builder.js": "runtime environment exposes semantic-transfer helpers and legacy metas",
  "agent/src/system-core/context/index.js": "context builder public attachment contract",
  "agent/src/system-core/context/session/message-converter.js": "replay compatibility preserves legacy fields",
  "agent/src/system-core/semantic-transfer/storage/attachment-adapter.js": "semantic-transfer adapter derives legacy fields centrally (semantic dir layout)",
  "agent/src/system-core/semantic-transfer/storage/consumer.js": "semantic-transfer consumer accepts legacy fallback (semantic dir layout)",
  "agent/src/system-core/semantic-transfer/core/compact.js": "semantic-transfer compact model view reads envelope attachmentMeta/filePath fields",
  "agent/src/system-core/semantic-transfer/transfer/tool-result-overflow.js": "semantic-transfer overflow compacts TransferEnvelope file fields and emits original-file envelope references",
  "agent/src/system-core/semantic-transfer/legacy-adapter.js": "central legacy compatibility adapter",
  "agent/src/system-core/semantic-transfer/envelope/normalizer.js": "semantic-transfer normalizes legacy fallback (semantic dir layout)",
  "agent/src/system-core/semantic-transfer/storage/path-resolver.js": "semantic-transfer path resolver compatibility (semantic dir layout)",
  "agent/src/system-core/tools/ai-models/multimodal-generate-tool.js": "multimodal tool returns attachmentMetas from attachmentService for existing consumers",
  "agent/src/system-core/tools/connectors/connector-toolkit/tool-access-connector.js": "connector output keeps attachmentMetas compatibility; ordinary email attachment save stays on attachmentService",
  "agent/src/system-core/tools/core/check-tool-input.js": "tool input schema/error details use filePath as user field",
  "agent/src/system-core/tools/data-processing/doc2data-tool.js": "tool input/output compatibility",
  "agent/src/system-core/tools/data-processing/media2data-tool.js": "tool input/output compatibility",
  "agent/src/system-core/tools/data-processing/web2data-tool.js": "tool input path schema",
  "agent/src/system-core/tools/execution/file-patch.js": "file patch public API uses filePath-style variable/detail names unrelated to semantic-transfer output",
  "agent/src/system-core/tools/execution/file-search.js": "file search public result schema uses filePath for searched workspace files",
  "agent/src/system-core/tools/execution/file-tools.js": "file tool public schema/results use filePath as user-facing workspace file address",
  "agent/src/system-core/tools/execution/file-tool.js": "file tool public input schema",
  "agent/src/system-core/tools/collaboration/agent-collab/collab-artifact-persist.js": "agent-collab async result output keeps attachmentMetas compatibility; ordinary save stays on attachmentService",
  "agent/src/system-core/tools/collaboration/agent-collab/collab-task-utils.js": "agent-collab payload compatibility",
  "agent/src/system-core/tools/collaboration/agent-collab/tool-wait-async-result.js": "agent-collab wait result compatibility",

  "client/noobot-chat/src/composables/infra/messageModel.js": "frontend message model keeps legacy fallback but consumes transfer first",
  "client/noobot-chat/src/composables/infra/transferEnvelope.js": "frontend semantic-transfer adapter maps envelope files to legacy display metas",
  "client/noobot-chat/src/composables/message/useMessageFiles.js": "frontend message file list consumes attachmentMetas compatibility after transfer-first extraction",

  "plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/output-finalizer.js": "harness final output legacy fallback with transfer payload",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/controller.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/model-runner.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/planning/refinement-runner.js": "harness relay compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/attachment-log-utils.js": "harness central compatibility helper",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/message/injection-utils.js": "harness injected message compatibility",
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/sandbox-path.js": "harness path block compatibility",

  "plugin/noobot-plugin-workflow/src/core/hooks.js": "workflow payload keeps transfer fields with legacy fallback",
  "plugin/noobot-plugin-workflow/src/core/hooks/attachments.js": "workflow central attachment/transfer bridge consumes envelope file fields and legacy attachmentMetas fallback",
  "plugin/noobot-plugin-workflow/src/core/hooks/node-agent.js": "workflow node sub-session compatibility still passes input attachmentMetas alongside transfer payloads",
  "plugin/noobot-plugin-workflow/src/core/hooks/persistence.js": "workflow persistence snapshots keep attachmentMetas compatibility while transfer payload migrates",
  "plugin/noobot-plugin-workflow/src/core/orchestrator/execution-runner.js": "workflow orchestrator compatibility publishes node result attachmentMetas derived from transfer payloads",
  "plugin/noobot-plugin-workflow/src/core/orchestrator/payload-enrichment.js": "workflow orchestrator enriches legacy node attachmentMetas for existing consumers",
  "plugin/noobot-plugin-workflow/src/core/orchestrator/planning-message.js": "workflow planning message contract initializes attachmentMetas for compatibility",
  "plugin/noobot-plugin-workflow/src/core/orchestrator/result-publisher.js": "workflow result publisher keeps attachmentMetas compatibility in final payload",
  "plugin/noobot-plugin-workflow/src/core/orchestrator/semantic-resolution.js": "workflow semantic resolution renders existing attachmentMetas contract for prompts",
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

function isCommentOrEmptyLine(line = "") {
  const text = String(line || "").trim();
  return (
    !text ||
    text.startsWith("//") ||
    text.startsWith("*") ||
    text.startsWith("/*")
  );
}

function detectFile(file) {
  const rel = toPosix(path.relative(ROOT, file));
  const raw = readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const violations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (SETTLED_ATTACHMENT_SERVICE_ONLY_FILES.has(rel)) {
      if (!isCommentOrEmptyLine(line)) {
        for (const item of OUT_OF_SCOPE_SEMANTIC_TRANSFER_REGEXES) {
          if (!item.regex.test(line)) continue;
          violations.push({
            type: "out-of-scope-semantic-persistence",
            field: item.api,
            file: rel,
            line: index + 1,
            text: line.trim(),
            hint: `${SETTLED_ATTACHMENT_SERVICE_ONLY_FILES.get(rel)}; do not route this ordinary attachment save/result through semantic-transfer or emit noobot.semantic-transfer envelopes here.`,
          });
        }
      }
    }

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

    for (const item of REMOVED_PUBLIC_WRAPPER_REGEXES) {
      if (!item.regex.test(line)) continue;
      if (REMOVED_PUBLIC_WRAPPER_ALLOWED_FILES.has(rel)) continue;
      violations.push({
        type: "removed-public-wrapper",
        field: item.api,
        file: rel,
        line: index + 1,
        text: line.trim(),
        hint: "Do not reintroduce removed semantic-transfer wrapper APIs; route through transferSemanticContent({ scenario, strategy, ... }) or private strategy implementation files.",
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
