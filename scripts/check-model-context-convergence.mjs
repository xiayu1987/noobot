#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
/*
 * Model context convergence guard.
 *
 * Required invariant for messages sent to the main model:
 *   system -> history -> incremental
 *
 * The invariant must be resolved in the agent message-store pipeline, not by
 * scattered harness-side compatibility composition. This script is intentionally
 * static and conservative: if it fails, remove the extra context handling path
 * instead of adding a compatibility exception.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd();
  if (exists(path.join(cwd, "agent", "src", "system-core")) && exists(path.join(cwd, "plugin", "noobot-plugin-harness", "src"))) {
    return cwd;
  }
  if (path.basename(cwd) === "agent" && exists(path.join(cwd, "src", "system-core"))) {
    return path.dirname(cwd);
  }
  if (path.basename(cwd) === "noobot-plugin-harness" && exists(path.join(cwd, "src"))) {
    return path.dirname(path.dirname(cwd));
  }
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "agent", "src", "system-core"))) return parent;
  return cwd;
}

const ROOT = resolveRepoRoot();
const SOURCE_ROOTS = [
  path.join(ROOT, "agent", "src", "system-core"),
  path.join(ROOT, "plugin", "noobot-plugin-harness", "src"),
];
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORE_PATH_PARTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}report${path.sep}`,
  `${path.sep}workspace${path.sep}`,
  `${path.sep}logs${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function readRel(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return readFileSync(fullPath, "utf8");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
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

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function snippetAt(text, index, length = 180) {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const failures = [];
const passed = [];

function fail(title, detail = "") {
  failures.push({ title, detail });
}

function pass(title) {
  passed.push(title);
}

function assertFileContains(relPath, checks = []) {
  const fullPath = path.join(ROOT, relPath);
  if (!existsSync(fullPath)) {
    fail(`missing required file: ${relPath}`);
    return "";
  }
  const text = readFileSync(fullPath, "utf8");
  for (const check of checks) {
    const ok = check.pattern instanceof RegExp
      ? check.pattern.test(text)
      : text.includes(String(check.pattern));
    if (!ok) {
      fail(`${relPath} missing convergence marker: ${check.name}`, String(check.pattern));
    }
  }
  if (checks.length) pass(`${relPath} required markers`);
  return text;
}

const sourceFiles = SOURCE_ROOTS.flatMap((dir) => walk(dir));
if (!sourceFiles.length) fail("no source files found for convergence scan", SOURCE_ROOTS.map(rel).join("\n"));

const legacyWindowScanRoots = [
  path.join(ROOT, "agent", "src"),
  path.join(ROOT, "agent", "__tests__"),
  path.join(ROOT, "plugin", "noobot-plugin-harness", "src"),
  path.join(ROOT, "plugin", "noobot-plugin-harness", "__tests__"),
  path.join(ROOT, "shared"),
  path.join(ROOT, "docs"),
];
const legacyWindowFiles = legacyWindowScanRoots.flatMap((dir) => walk(dir));
const legacyWindowTokens = [
  ["contextWindow", "RecentMessageLimit"].join(""),
  ["incremental", "RecentMessageLimit"].join(""),
  ["recentWindow", "MessageLimit"].join(""),
  ["nonMainContextWindow", "RecentMessageLimit"].join(""),
  ["mainModel", "RecentLimit"].join(""),
  ["mainModel", "RecentWindow"].join(""),
  ["session", "RecentMessageLimit"].join(""),
  ["recent", "MessageLimit"].join(""),
  ["normalize", "RecentWindow"].join(""),
  ["resolve", "ModelContextMessages"].join(""),
  ["use", "RecentWindow"].join(""),
  ["recent", "Limit"].join(""),
  ["最近 ", "20"].join(""),
  ["20 ", "条"].join(""),
];
const legacyWindowHits = [];
for (const file of legacyWindowFiles) {
  const text = readFileSync(file, "utf8");
  for (const token of legacyWindowTokens) {
    let index = text.indexOf(token);
    while (index >= 0) {
      legacyWindowHits.push({ file, token, index });
      index = text.indexOf(token, index + token.length);
    }
  }
}
if (legacyWindowHits.length) {
  fail(
    "legacy fixed-size non-main context window markers found",
    legacyWindowHits
      .slice(0, 12)
      .map((item) => `  ${rel(item.file)}:${lineOf(readFileSync(item.file, "utf8"), item.index)} ${item.token}`)
      .join("\n"),
  );
} else {
  pass("no legacy fixed-size non-main context window markers");
}

const sessionContextServiceText = readFileSync(
  path.join(ROOT, "agent", "src", "system-core", "session", "services", "session-context-service.js"),
  "utf8",
);
const getContextRecordsMatch = sessionContextServiceText.match(
  /async\s+getContextRecords\s*\([\s\S]*?\n\s*\}\n\s*\}/,
);
const getContextRecordsText = getContextRecordsMatch ? getContextRecordsMatch[0] : "";
if (
  /getMessagesSinceLast(?:Running|Completed)Task/.test(sessionContextServiceText) ||
  /useLast(?:Running|Completed)TaskRange/.test(getContextRecordsText)
) {
  fail(
    "task-range session context branch found",
    "Model context must resolve main-model history via latest dialog groups only.",
  );
} else {
  pass("session context has no task-range context branches");
}

const forbiddenSymbolPattern = /\b(resolveMessageBlock|composeFinalMessageBlocks|applyMessageBlocksForBeforeLlmCall|resolveFinalMessageBlocks|collectPayloadMessages|resolveContextSourceMessages|includePayloadMessages|shouldUsePayloadMessageFallback|resolveAgentModelMessages|misplacedSystemMessages)\b/g;
const SYSTEM_LIKE_ROLE_PATTERN = "(?:system|developer)";

const forbiddenPatterns = [
  {
    name: "legacy context/message-block compatibility helper",
    pattern: forbiddenSymbolPattern,
    advice: "删掉旧的上下文兼容/拼装路径，只保留 agent message-store resolver。",
  },
  {
    name: "flat ctx.messages fallback in model resolver",
    pattern: /Array\.isArray\(\s*ctx\?\.messages\s*\)\s*&&\s*ctx\.messages\.length/g,
    advice: "不要从 ctx.messages 做隐式 fallback；主链路必须使用 messageBlocks/system-history-incremental。",
  },
  {
    name: "tail system message after existing messages",
    pattern: /\[\s*\.\.\.[^\]]{0,500},\s*\{\s*role:\s*["'](?:system|developer)["']/gs,
    advice: "system/developer 类消息必须在大顺序最前面，不能 append 到已有 messages 后面。",
  },
  {
    name: "runtimeMessages tail system assignment",
    pattern: /runtimeMessages\s*=\s*\[\s*\.\.\.runtimeMessages\s*,\s*\{\s*role:\s*["'](?:system|developer)["']/gs,
    advice: "reasoning/retry 等运行时 system/developer 消息必须 prepend 或写入 system block。",
  },
  {
    name: "system message written to incremental block",
    pattern: /appendMessage\s*\([\s\S]{0,500}(?:role:\s*["'](?:system|developer)["']|new\s+SystemMessage\s*\()[\s\S]{0,500}block:\s*["']incremental["']/g,
    advice: "role=system/developer/SystemMessage 必须写入 system block，不能写入 incremental。",
  },
  {
    name: "message block id view used as context source",
    pattern: /\b(?:systemIds|historyIds|incrementalIds|resolveBlockMessagesByIds)\b/g,
    advice: "上下文分块唯一事实源只能是 messageBlocks.system/history/incremental 数组，不能再保留 blockIds 第二事实源。",
  },
];

for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  const fileRel = rel(file);
  for (const check of forbiddenPatterns) {
    check.pattern.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = check.pattern.exec(text))) {
      matches.push({ index: match.index, text: match[0] });
      if (match.index === check.pattern.lastIndex) check.pattern.lastIndex += 1;
    }
    if (!matches.length) continue;
    const detail = matches
      .slice(0, 8)
      .map((item) => `  ${fileRel}:${lineOf(text, item.index)} ${snippetAt(text, item.index)}`)
      .join("\n");
    fail(`${check.name}: ${fileRel}`, `${detail}\n${check.advice}`);
  }
}
if (!failures.some((item) => item.title.includes("legacy context/message-block compatibility helper"))) {
  pass("no legacy context compatibility helpers in source");
}
if (!failures.some((item) => item.title.includes("flat ctx.messages fallback"))) {
  pass("no flat ctx.messages fallback in resolver source");
}
if (!failures.some((item) => item.title.includes("tail system"))) {
  pass("no known tail-system append patterns in source");
}
if (!failures.some((item) => item.title.includes("system message written to incremental"))) {
  pass("no known system-to-incremental append pattern in source");
}

const normalizerText = assertFileContains("agent/src/system-core/session/utils/context-window-normalizer.js", [
  { name: "resolveMainModelSystemMessages", pattern: /export\s+function\s+resolveMainModelSystemMessages\b/ },
  { name: "resolveMainModelHistoryMessages", pattern: /export\s+function\s+resolveMainModelHistoryMessages\b/ },
  { name: "resolveMainModelIncrementalMessages", pattern: /export\s+function\s+resolveMainModelIncrementalMessages\b/ },
  { name: "resolveMainModelFinalMessages", pattern: /export\s+function\s+resolveMainModelFinalMessages\b/ },
  { name: "history excludes system-like roles", pattern: /isSystemLikeMessageRole\(resolveMessageRole\(messageItem\)\)/ },
  { name: "final order system/history/incremental", pattern: /messages:\s*\[\s*\.\.\.system\s*,\s*\.\.\.history\s*,\s*\.\.\.incremental\s*\]/ },
]);
const turnThresholdsText = readFileSync(
  path.join(ROOT, "shared", "turn-thresholds.mjs"),
  "utf8",
);
const historyLimitUsesTurnThreshold =
  normalizerText &&
  /MAIN_MODEL_HISTORY_ROUND_LIMIT\s*=\s*[\s\S]*?TURN_THRESHOLDS\.session\.mainModelHistoryRoundLimit\b/.test(normalizerText);
const centralHistoryLimitMatch = turnThresholdsText?.match(
  /mainModelHistoryRoundLimit:\s*(\d+)\b/,
);
const centralizedHistoryLimit = centralHistoryLimitMatch
  ? Number.parseInt(centralHistoryLimitMatch[1], 10)
  : NaN;
const centralizedHistoryLimitIsValid =
  Number.isInteger(centralizedHistoryLimit) && centralizedHistoryLimit > 0;
if (historyLimitUsesTurnThreshold && centralizedHistoryLimitIsValid) {
  pass(`main model history limit uses central latest ${centralizedHistoryLimit} dialog rounds`);
} else {
  fail(
    "history round limit drifted",
    "MAIN_MODEL_HISTORY_ROUND_LIMIT must use TURN_THRESHOLDS.session.mainModelHistoryRoundLimit, and that central value must be a positive integer.",
  );
}

const mainIncrementalResolverMatch = normalizerText.match(
  /export\s+function\s+resolveMainModelIncrementalMessages\s*\([\s\S]*?\n}\n/,
);
const mainIncrementalResolverText = mainIncrementalResolverMatch
  ? mainIncrementalResolverMatch[0]
  : "";
if (!mainIncrementalResolverText) {
  fail(
    "main incremental resolver body missing",
    "resolveMainModelIncrementalMessages must remain explicit so append-only incremental semantics can be guarded.",
  );
} else if (
  /\bkeepLatestInjectedOnly\b/.test(mainIncrementalResolverText) ||
  /\bfilterLatestInjectedMessagesByType\b/.test(mainIncrementalResolverText) ||
  /\bfilterInjectedMessagesForDialog\b/.test(mainIncrementalResolverText)
) {
  fail(
    "main incremental resolver compacts injected messages",
    "Main incremental context must stay append-only before summary: do not apply latest-injected or dialog injected compaction in resolveMainModelIncrementalMessages.",
  );
} else if (
  !/return\s+filterForModelContext\(\s*sourceMessages\s*\)\s*;/.test(mainIncrementalResolverText)
) {
  fail(
    "main incremental resolver drifted from append-only filter",
    "resolveMainModelIncrementalMessages must filter only summarized/invalid tool-pair messages via filterForModelContext(sourceMessages).",
  );
} else {
  pass("main incremental keeps unsummarized injected messages append-only");
}

const helpersText = assertFileContains("agent/src/system-core/bot-manage/session/model-message-runtime-helpers.js", [
  { name: "uses central final resolver", pattern: /resolveMainModelFinalMessages/ },
  { name: "reads messageBlocks", pattern: /ctx\?\.messageBlocks/ },
  { name: "resolves system block", pattern: /resolveBlockMessages\(ctx,\s*blocks,\s*["']system["']\)/ },
  { name: "resolves history block", pattern: /resolveBlockMessages\(ctx,\s*blocks,\s*["']history["']\)/ },
  { name: "resolves incremental block", pattern: /resolveBlockMessages\(ctx,\s*blocks,\s*["']incremental["']\)/ },
  { name: "explicit block arrays are the only block source", pattern: /function\s+resolveBlockMessages[\s\S]*?Array\.isArray\(blocks\?\.\[blockName\]\)[\s\S]*?return\s+blocks\[blockName\][\s\S]*?return\s+\[\]/ },
]);
if (helpersText && /ctx\?\.agentContext\?\.payload\?\.messages/.test(helpersText)) {
  if (/includePayloadBlocks/.test(helpersText) && /typeof\s+agentPayloadMessages\s*===\s*["']object["']\s*&&\s*!Array\.isArray\(agentPayloadMessages\)/.test(helpersText)) {
    pass("payload messages are only accepted as structured message blocks for scoped non-main purposes");
  } else {
    fail("payload messages fallback is not block-scoped", "payload.messages must not become a flat compatibility context source.");
  }
}

assertFileContains("agent/src/system-core/agent/core/turn/turn-executor.js", [
  { name: "main turn uses central final resolver", pattern: /resolveMainModelFinalMessages/ },
]);

assertFileContains("agent/src/system-core/context/index.js", [
  { name: "new-session context resolves session history", pattern: /async\s+buildNewSessionContext[\s\S]*?_resolveSessionRecords/ },
  { name: "existing-session context resolves session history", pattern: /async\s+buildExistingSessionContext[\s\S]*?_resolveSessionRecords/ },
  { name: "context passes current turnScopeId to session history", pattern: /currentTurnScopeId:\s*String\(this\.runConfig\?\.turnScopeId/ },
]);

assertFileContains("agent/src/system-core/session/index.js", [
  { name: "session facade uses context payload normalizer", pattern: /function\s+normalizeContextServicePayload[\s\S]*?currentDialogProcessId[\s\S]*?currentTurnScopeId/ },
  { name: "session facade passes normalized payload to getContextRecords", pattern: /async\s+getContextRecords\(payload\s*=\s*\{\}\)[\s\S]*?sessionContextService\.getContextRecords\(\s*normalizeContextServicePayload\(payload\)/ },
]);

assertFileContains("agent/src/system-core/session/services/session-context-service.js", [
  { name: "session history excludes current turn before recent dialogs", pattern: /_filterCurrentRunMessages[\s\S]*?_filterCurrentDialogMessages[\s\S]*?_filterCurrentTurnMessages/ },
  { name: "recent history uses current dialog exclusion", pattern: /async\s+getRecentSessionMessages[\s\S]*?currentDialogProcessId[\s\S]*?_filterCurrentRunMessages[\s\S]*?currentTurnScopeId,\s*currentDialogProcessId/ },
]);

const messageBuilderText = readFileSync(
  path.join(ROOT, "agent", "src", "system-core", "agent", "core", "context", "message-builder.js"),
  "utf8",
);
if (
  /\bsameCurrentText\b/.test(messageBuilderText) ||
  /String\(\s*msg\?\.content\s*\|\|\s*["']["']\s*\)\.trim\(\)\s*===\s*normalizedCurrentUserMessage/.test(messageBuilderText)
) {
  fail(
    "history filtering by current user text found",
    "Repeated goals such as “下一步” must not delete previous dialogProcessId history rounds; only current turn/dialog ids may be filtered.",
  );
} else {
  pass("history filtering does not drop previous rounds by repeated user text");
}

assertFileContains("plugin/noobot-plugin-harness/src/core/model-message-context.js", [
  { name: "harness before_llm_call delegates to resolver", pattern: /applyAgentResolvedModelMessages/ },
  { name: "uses injected resolveModelMessages", pattern: /resolveModelMessages/ },
  { name: "updates through message-store replaceMessages", pattern: /replaceMessages\(ctx,\s*resolved\)/ },
]);

const messageStoreText = assertFileContains("agent/src/system-core/agent/core/message-context/message-store.js", [
  { name: "message-store owns noobot ids", pattern: /function\s+resolveMessageId[\s\S]*?readField\(message,\s*["']noobotMessageId["']\)[\s\S]*?readField\(message,\s*["']messageId["']\)/ },
  { name: "message-store bumps next id for hydrated ids", pattern: /function\s+bumpNextMessageId[\s\S]*?match\(\s*\/\^am_\(\[0-9a-z\]\+\)\$\/i\s*\)[\s\S]*?store\.nextId\s*=\s*numeric\s*\+\s*1/ },
  { name: "replaceMessages only replaces flat view", pattern: /export\s+function\s+replaceMessages[\s\S]*?holder\.messages\.splice\(0,\s*holder\.messages\.length,\s*\.\.\.canonicalMessages\)[\s\S]*?return\s+holder\.messages/ },
  { name: "messageBlocks deletes old block id views", pattern: /for\s*\(\s*const\s+staleField\s+of\s+\[[\s\S]*?system[\s\S]*?history[\s\S]*?incremental[\s\S]*?delete\s+blocks\[staleField\]/ },
]);
if (messageStoreText) {
  const resolveIdMatch = messageStoreText.match(/function\s+resolveMessageId[\s\S]*?\n}/);
  if (resolveIdMatch && /readField\(message,\s*["']id["']\)/.test(resolveIdMatch[0])) {
    fail("message-store must not use provider id as canonical id", "Only noobotMessageId/messageId are allowed; provider id collisions can cross-wire system/history/incremental blocks.");
  } else {
    pass("message-store ignores provider id as canonical id");
  }
  const replaceMatch = messageStoreText.match(/export\s+function\s+replaceMessages[\s\S]*?\n}/);
  if (replaceMatch && /canonicalizeMessageStore\(holder\)\s*;[\s\S]*return\s+holder\.messages/.test(replaceMatch[0])) {
    fail("replaceMessages re-canonicalizes blocks after replacing flat messages", "replaceMessages must not rewrite messageBlocks; writeMessageBlocks is the only block mutation path.");
  } else {
    pass("replaceMessages does not rewrite messageBlocks after flat replacement");
  }
}

assertFileContains("agent/src/system-core/agent/core/hook/hook-context-builder.js", [
  { name: "hook context carries messageStore", pattern: /messageStore:\s*safeRaw\?\.messageStore\s*\?\?\s*safeRaw\?\.loopState\?\.messageStore\s*\?\?\s*null/ },
]);

assertFileContains("agent/src/system-core/agent/core/turn/turn-executor.js", [
  { name: "before_llm hook passes messageStore", pattern: /buildHookContext\(AGENT_HOOK_POINTS\.BEFORE_LLM_CALL[\s\S]*?messageStore:\s*loopState\.messageStore/ },
]);

assertFileContains("plugin/noobot-plugin-harness/src/capabilities/handlers/shared/model/message-factory.js", [
  { name: "splits agent system messages", pattern: /agentSystemMessages/ },
  { name: "splits agent conversation messages", pattern: /agentConversationMessages/ },
  { name: "capability order system before conversation", pattern: /return\s+\[\s*\.\.\.systemMessages\s*,\s*\.\.\.conversationMessages\s*\]/ },
]);

const loopControlText = assertFileContains("agent/src/system-core/agent/core/loop-control.js", [
  { name: "help tool loop marker", pattern: /HELP_TOOL_LOOP_PROMPT_MARKER/ },
]);
if (loopControlText) {
  const markerIndex = loopControlText.indexOf("HELP_TOOL_LOOP_PROMPT_MARKER");
  const appendIndex = loopControlText.indexOf("appendMessage(loopState, new SystemMessage", Math.max(0, markerIndex - 1000));
  const blockIndex = loopControlText.indexOf('block: "system"', appendIndex >= 0 ? appendIndex : 0);
  if (appendIndex >= 0 && blockIndex >= appendIndex && blockIndex - appendIndex < 900) {
    pass("help tool loop prompt writes SystemMessage to system block");
  } else {
    fail("help tool loop prompt is not guarded as system block", "SystemMessage produced by maybePromptHelpToolByLoop must use { block: \"system\" }.");
  }
}


function extractJsonObjectsAfterBody(text = "") {
  const bodies = [];
  let cursor = 0;
  while (cursor < text.length) {
    const bodyIndex = text.indexOf("Body:", cursor);
    if (bodyIndex < 0) break;
    const start = text.indexOf("{", bodyIndex);
    if (start < 0) break;
    let depth = 0;
    let state = "code";
    let quote = "";
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (state === "string") {
        if (char === "\\") {
          index += 1;
          continue;
        }
        if (char === quote) {
          state = "code";
          quote = "";
        }
        continue;
      }
      if (char === "\"" || char === "'") {
        state = "string";
        quote = char;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(text.slice(start, index + 1));
          cursor = index + 1;
          break;
        }
      }
    }
    if (cursor <= start) break;
  }
  return bodies;
}

function normalizeLogRole(message = {}) {
  return String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
}

function isSystemLikeLogRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "system" || normalized === "developer";
}

function validateRequestLogOrder(logPath = "") {
  const fullPath = path.isAbsolute(logPath) ? logPath : path.join(process.cwd(), logPath);
  if (!existsSync(fullPath)) {
    fail(`missing request log: ${logPath}`);
    return;
  }
  const text = readFileSync(fullPath, "utf8");
  const bodies = extractJsonObjectsAfterBody(text);
  if (!bodies.length) {
    fail(`request log has no parseable Body JSON: ${logPath}`);
    return;
  }
  let checked = 0;
  for (const [bodyIndex, bodyText] of bodies.entries()) {
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      fail(`request log Body JSON parse failed: ${logPath}`, error?.message || String(error));
      continue;
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) continue;
    checked += 1;
    const systemLikeCount = messages.filter((message) => isSystemLikeLogRole(normalizeLogRole(message))).length;
    const systemLikeContents = messages
      .filter((message) => isSystemLikeLogRole(normalizeLogRole(message)))
      .map((message) => String(message?.content || ""));
    const hasOnlyHarnessSystem = systemLikeCount > 0 && systemLikeContents.every((content) =>
      content.includes("HARNESS_POLICY_SELECTION") ||
        content.includes("noobot-harness-current-task-goal") ||
        content.includes("[CURRENT_TASK_GOAL]"),
    );
    if (!systemLikeCount) {
      fail(
        `request log missing constructed system block: ${logPath} Body#${bodyIndex + 1}`,
        "model request must include constructed system/developer messages before history/incremental.",
      );
    } else if (hasOnlyHarnessSystem) {
      fail(
        `request log system block only contains harness injections: ${logPath} Body#${bodyIndex + 1}`,
        "constructed agent system context was not present; harness policy/goal cannot replace system.",
      );
    }
    let seenConversation = false;
    const bad = [];
    messages.forEach((message, index) => {
      const role = normalizeLogRole(message);
      if (!isSystemLikeLogRole(role)) {
        seenConversation = true;
        return;
      }
      if (seenConversation) {
        const content = typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
        bad.push(`${index}:${role}:${String(content || "").slice(0, 80).replace(/\s+/g, " ")}`);
      }
    });
    if (bad.length) {
      fail(
        `request log order violation: ${logPath} Body#${bodyIndex + 1}`,
        `system/developer must be before history/incremental, but found after conversation:\n  ${bad.join("\n  ")}`,
      );
    }
  }
  if (checked) pass(`request log order checked: ${logPath}`);
}

for (const logPath of process.argv.slice(2)) {
  validateRequestLogOrder(logPath);
}

if (failures.length) {
  console.error("[check-model-context-convergence] FAILED");
  console.error("Invariant: model messages must be resolved centrally as system -> history -> incremental.\n");
  for (const item of failures) {
    console.error(`- ${item.title}`);
    if (item.detail) console.error(item.detail);
  }
  process.exit(1);
}

console.log(`[check-model-context-convergence] ok (${sourceFiles.length} source files scanned)`);
for (const item of passed) {
  console.log(`- ${item}`);
}
