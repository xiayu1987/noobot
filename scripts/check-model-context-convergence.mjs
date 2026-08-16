#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
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
  if (exists(path.join(cwd, "agent", "src")) && exists(path.join(cwd, "plugin", "noobot-plugin-harness", "src"))) {
    return cwd;
  }
  if (path.basename(cwd) === "agent" && exists(path.join(cwd, "src"))) {
    return path.dirname(cwd);
  }
  if (path.basename(cwd) === "noobot-plugin-harness" && exists(path.join(cwd, "src"))) {
    return path.dirname(path.dirname(cwd));
  }
  const parent = path.dirname(cwd);
  if (exists(path.join(parent, "agent", "src"))) return parent;
  return cwd;
}

const ROOT = resolveRepoRoot();
const SOURCE_ROOTS = [
  path.join(ROOT, "context-protocol", "src"),
  path.join(ROOT, "agent", "src"),
  path.join(ROOT, "plugin", "noobot-plugin-harness", "src"),
  path.join(ROOT, "plugin", "noobot-plugin-workflow", "src"),
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
  path.join(ROOT, "agent", "src", "session", "services", "session-context-service.js"),
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
  {
    name: "injected message type inferred from content",
    pattern: /\b(?:recognizeContent|resolveContentType|isPluginRelayContent|resolvePluginRelayInjectedMessageType|isInjectedMessageLike)\b/g,
    advice: "注入消息只能使用 injectedMessage/injectedBy/injectedMessageType 协议字段，禁止从内容前缀推断。",
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
if (!failures.some((item) => item.title.includes("injected message type inferred from content"))) {
  pass("injected message classification never falls back to content");
}

const SUMMARY_POLICY_PATH = "context-protocol/src/summary-policy.js";
const TERMINAL_HISTORY_POLICY_PATH = "context-protocol/src/terminal-history-policy.js";
const latestInjectionPolicyPattern = /\b(?:keepLatestInjectedOnly|filterLatestInjectedMessagesByType|filterInjectedMessagesForDialog|collectLatestInjectedMessageIndexes)\b/g;
const latestInjectionPolicyHits = [];
for (const file of sourceFiles) {
  const fileRel = rel(file);
  if (fileRel === SUMMARY_POLICY_PATH || fileRel === TERMINAL_HISTORY_POLICY_PATH) continue;
  const text = readFileSync(file, "utf8");
  latestInjectionPolicyPattern.lastIndex = 0;
  let match;
  while ((match = latestInjectionPolicyPattern.exec(text))) {
    latestInjectionPolicyHits.push({ file: fileRel, index: match.index, token: match[0] });
  }
}
if (latestInjectionPolicyHits.length) {
  fail(
    "latest injected-message retention escaped summary or terminal-history policy",
    latestInjectionPolicyHits
      .slice(0, 12)
      .map((item) => `  ${item.file}:${lineOf(readRel(item.file), item.index)} ${item.token}`)
      .join("\n"),
  );
} else {
  pass("latest injected-message retention exists only in summary and terminal-history policies");
}

const summarizedMutationAllowed = new Set([
  SUMMARY_POLICY_PATH,
  "context-protocol/src/message-store.js",
  "context-protocol/src/context-mutation.js",
  "context-protocol/src/snapshot-policy.js",
  "agent/src/runtime/resume/model-message-snapshot-store.js",
  "agent/src/bot/session/summary-checkpoint-committer.js",
  "agent/src/session/services/session-message-service/turn-summary-checkpoint.js",
]);
const summarizedMutationPattern = /summarized\s*(?:=|:)\s*true/g;
const summarizedMutationHits = [];
for (const file of sourceFiles) {
  const fileRel = rel(file);
  if (summarizedMutationAllowed.has(fileRel)) continue;
  const text = readFileSync(file, "utf8");
  summarizedMutationPattern.lastIndex = 0;
  let match;
  while ((match = summarizedMutationPattern.exec(text))) {
    summarizedMutationHits.push({ file: fileRel, index: match.index });
  }
}
if (summarizedMutationHits.length) {
  fail(
    "summarized state mutation exists outside canonical summary ownership",
    summarizedMutationHits
      .slice(0, 12)
      .map((item) => `  ${item.file}:${lineOf(readRel(item.file), item.index)}`)
      .join("\n"),
  );
} else {
  pass("summarized writes are restricted to summary policy, checkpoint persistence, and snapshot hydration");
}

const summaryMutationCallAllowed = new Set([
  SUMMARY_POLICY_PATH,
  "context-protocol/src/message-store.js",
  "context-protocol/src/context-mutation.js",
  "context-protocol/src/turn-completion-policy.js",
  "agent/src/runtime/turn/turn-result-aggregator.js",
  "agent/src/bot/session/summary-checkpoint-committer.js",
]);
const summaryMutationCallPattern = /\b(?:markCurrentTurn(?:Store|Array|ModelMessages)Summarized|markScopedMessagesSummarized|markMessagesSummarizedByIds)\s*\(/g;
const summaryMutationCallHits = [];
for (const file of sourceFiles) {
  const fileRel = rel(file);
  if (summaryMutationCallAllowed.has(fileRel)) continue;
  const text = readFileSync(file, "utf8");
  summaryMutationCallPattern.lastIndex = 0;
  let match;
  while ((match = summaryMutationCallPattern.exec(text))) {
    summaryMutationCallHits.push({ file: fileRel, index: match.index, token: match[0] });
  }
}
if (summaryMutationCallHits.length) {
  fail(
    "summary mutation API called outside the three authoritative flows",
    summaryMutationCallHits
      .slice(0, 12)
      .map((item) => `  ${item.file}:${lineOf(readRel(item.file), item.index)} ${item.token}`)
      .join("\n"),
  );
} else {
  pass("summary mutation API is restricted to checkpoint commit and completed-turn finalization");
}

assertFileContains("context-protocol/src/window-reducer.js", [
  { name: "history excludes system-like roles", pattern: /isSystemLikeMessageRole\(resolveMessageRole\(message\)\)/ },
  { name: "final order system/history/incremental", pattern: /messages:\s*\[\s*\.\.\.system\s*,\s*\.\.\.history\s*,\s*\.\.\.incremental\s*\]/ },
  { name: "cross-block identity requires canonical message id", pattern: /const explicitId = resolveMessageId\(message\);[\s\S]*?return explicitId \? `id:\$\{explicitId\}` : ""/ },
]);
const messagePolicyText = assertFileContains("context-protocol/src/message-policy.js", [
  { name: "message policy delegates canonical identity to codec", pattern: /return\s+resolveContextMessageId\(message\)/ },
  { name: "injected marker delegates to canonical flags", pattern: /return\s+resolveContextMessageFlags\(message\)\.injected/ },
]);
const policyResolveIdMatch = messagePolicyText.match(/export\s+function\s+resolveMessageId[\s\S]*?\n}/);
if (policyResolveIdMatch && /readMessageField\(message,\s*["'](?:id|messageId)["']\)/.test(policyResolveIdMatch[0])) {
  fail(
    "message policy accepts a non-canonical identity",
    "Cross-block identity must come only from noobotMessageId.",
  );
} else {
  pass("message policy uses only noobotMessageId as canonical id");
}
assertFileContains("agent/src/bot/session/session-execution-engine-utils.js", [
  { name: "model runtime normalization preserves canonical message id", pattern: /const noobotMessageId = getMessageId\(messageItem\)[\s\S]*?noobotMessageId/ },
  { name: "model runtime normalization preserves turn scope", pattern: /readMessageField\(messageItem,\s*"turnScopeId"\)/ },
]);
assertFileContains("context-protocol/src/block-strategy.js", [
  { name: "owns canonical system/history/incremental composition", pattern: /export\s+function\s+buildCanonicalMessageBlocks\b/ },
  { name: "owns snapshot history grouping identity", pattern: /export\s+function\s+createHistoryRoundIdentityResolver\b/ },
  { name: "owns current-turn history exclusion", pattern: /export\s+function\s+filterCurrentTurnMessagesFromHistory\b/ },
]);
assertFileContains("context-protocol/src/summary-policy.js", [
  { name: "owns summary scope marking", pattern: /export\s+function\s+markScopedMessagesSummarized\b/ },
  { name: "owns latest task summary pair", pattern: /export\s+function\s+collectLatestTaskSummaryMessageIndexes\b/ },
]);
assertFileContains("context-protocol/src/terminal-history-policy.js", [
  { name: "owns terminal history projection", pattern: /export\s+function\s+projectTerminalHistoryMessages\b/ },
  { name: "terminal projection requires canonical round identity", pattern: /terminal history status requires dialogProcessId and turnScopeId/ },
  { name: "terminal projection derives a stable explanation identity", pattern: /`\$\{status\.turnScopeId\}::terminal_status`/ },
]);
assertFileContains("agent/src/session/services/session-context-service.js", [
  { name: "delegates source projection to Context Protocol", pattern: /@noobot\/context-protocol[\s\S]*?projectContextSource/ },
  { name: "reads messages and statuses from one authoritative snapshot", pattern: /getSessionContextSource/ },
]);
const summaryCheckpointText = assertFileContains("agent/src/bot/session/summary-checkpoint-committer.js", [
  { name: "summary checkpoint matches canonical ids", pattern: /summarizedMessageIds\.has\(resolveMessageId\(message\)\)/ },
]);
if (/buildMessageIdentity|remainingByIdentity|summarizedMessages/.test(summaryCheckpointText)) {
  fail(
    "summary checkpoint contains a non-canonical identity path",
    "Summary checkpoint persistence must resolve only canonical message ids.",
  );
} else {
  pass("summary checkpoint persistence uses canonical ids only");
}
const sessionMessageServiceText = readFileSync(
  path.join(ROOT, "agent", "src", "session", "services", "session-message-service.js"),
  "utf8",
);
const sessionFacadeText = readFileSync(
  path.join(ROOT, "agent", "src", "session", "index.js"),
  "utf8",
);
if (/markSessionMessagesSummarized/.test(sessionMessageServiceText) || /markSessionMessagesSummarized/.test(sessionFacadeText)) {
  fail(
    "direct session summarized-message mutation port remains",
    "Persisted summarized state must be written only by the canonical UID checkpoint transaction.",
  );
} else {
  pass("session exposes only the canonical summary checkpoint mutation");
}
const taskSummaryToolText = readFileSync(
  path.join(ROOT, "agent", "src", "tools", "collaboration", "task-summary-tool.js"),
  "utf8",
);
if (/markCurrentTurn(?:Store|ModelMessages|Array)Summarized/.test(taskSummaryToolText)) {
  fail(
    "task_summary mutates summarized state before checkpoint commit",
    "task_summary must request the UID checkpoint through the orchestrator without pre-marking memory.",
  );
} else {
  pass("task_summary has no pre-checkpoint summarized mutation");
}
assertFileContains("agent/src/session/services/session-message-service/turn-summary-checkpoint.js", [
  {
    name: "terminal recovery cannot append messages",
    pattern: /isTerminalTurnLifecycleState\(lifecycleTurn\.state\)[\s\S]*?normalizedPersistedUids\.length[\s\S]*?TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE/,
  },
]);
const guidanceSummaryTrackerText = assertFileContains(
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/signal-tracker.js",
  [
    { name: "guidance checkpoint captures canonical ids", pattern: /summaryCheckpointMessageIds\s*=\s*messageIds/ },
    { name: "guidance checkpoint capture owns incremental only", pattern: /const sourceMessages\s*=\s*blocks\.incremental/ },
    { name: "guidance checkpoint commit owns incremental only", pattern: /const coveredMessages\s*=\s*blocks\.incremental/ },
    { name: "guidance checkpoint rejects unclosed history", pattern: /assertSummaryHistoryClosed\(blocks\.history\)/ },
  ],
);
if (/summaryCheckpointMessageCount/.test(guidanceSummaryTrackerText)) {
  fail(
    "guidance summary checkpoint retains a count-based scope",
    "The checkpoint scope must have one representation: canonical message ids.",
  );
} else {
  pass("guidance summary checkpoint uses one canonical id scope");
}
assertFileContains("agent/src/runtime/tool-execution/state-committer.js", [
  {
    name: "tool result shares persistence identity with model context",
    pattern: /additional_kwargs:\s*\{\s*noobotMessageId:\s*messageUid\s*\}/,
  },
]);
assertFileContains("context-protocol/src/snapshot-policy.js", [
  { name: "owns snapshot serialization", pattern: /export\s+function\s+createModelContextSnapshot\b/ },
  { name: "owns snapshot hydration", pattern: /export\s+function\s+hydrateModelContextSnapshot\b/ },
  { name: "owns recovered identity projection", pattern: /export\s+function\s+projectRecoveredMessagesToIdentity\b/ },
]);
const stoppedResumePreparerText = assertFileContains(
  "agent/src/bot/session/turn-execution-preparer.js",
  [
    { name: "stopped resume loads the authoritative snapshot", pattern: /loadStoppedModelMessageSnapshot\s*\(/ },
    { name: "stopped resume reads snapshot system block", pattern: /snapshot\?\.messageBlocks\?\.system/ },
    { name: "stopped resume reads snapshot history block", pattern: /snapshot\?\.messageBlocks\?\.history/ },
    { name: "stopped resume reads snapshot incremental block", pattern: /snapshot\?\.messageBlocks\?\.incremental/ },
  ],
);
if (
  /projectTerminalHistoryMessages|getContextRecords|buildExistingSessionContext|buildContinueContext/.test(
    stoppedResumePreparerText,
  )
) {
  fail(
    "stopped snapshot resume rebuilds blocks from Session history",
    "A successful stopped resume must source system/history/incremental only from the stopped snapshot.",
  );
} else {
  pass("stopped resume sources all three Context blocks only from its snapshot");
}
assertFileContains("agent/src/context/assembly/message-builder/context-blocks.js", [
  { name: "delegates block strategy to context protocol", pattern: /@noobot\/context-protocol\/block-strategy/ },
]);
const snapshotStoreText = assertFileContains("agent/src/runtime/resume/model-message-snapshot-store.js", [
  { name: "delegates snapshot strategy to context protocol", pattern: /@noobot\/context-protocol\/snapshot-policy/ },
]);
if (/legacySnapshotPath\b/.test(snapshotStoreText)) {
  fail(
    "stopped snapshot legacy path fallback remains",
    "Stopped snapshots must use the single parent-aware canonical path.",
  );
} else {
  pass("stopped snapshots use one canonical storage path");
}
const turnThresholdsText = readFileSync(
  path.join(ROOT, "shared", "turn-thresholds.mjs"),
  "utf8",
);
const contextBlocksText = readRel("agent/src/context/assembly/message-builder/context-blocks.js");
const sessionContextText = readRel("agent/src/session/services/session-context-service.js");
const historyLimitUsesTurnThreshold = [contextBlocksText, sessionContextText].every((source) =>
  /TURN_THRESHOLDS\.session\.mainModelHistoryRoundLimit\b/.test(source),
);
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
    "Every Agent history projection must use TURN_THRESHOLDS.session.mainModelHistoryRoundLimit, and that central value must be a positive integer.",
  );
}

const windowReducerText = readRel("context-protocol/src/window-reducer.js");
const mainHistoryResolverMatch = windowReducerText.match(
  /export\s+function\s+resolveModelHistoryMessages\s*\([\s\S]*?\n}\n/,
);
const mainHistoryResolverText = mainHistoryResolverMatch
  ? mainHistoryResolverMatch[0]
  : "";
if (!mainHistoryResolverText) {
  fail(
    "main history resolver body missing",
    "resolveModelHistoryMessages must remain explicit so complete unsummarized dialog rounds can be guarded.",
  );
} else if (/\bkeepLatestInjectedOnly\b|\bfilterLatestInjectedMessagesByType\b|\bfilterInjectedMessagesForDialog\b/.test(mainHistoryResolverText)) {
  fail(
    "main history resolver compacts injected messages",
    "History must preserve every unsummarized message inside each selected dialog round.",
  );
} else {
  pass("main history preserves complete unsummarized dialog rounds");
}
const mainIncrementalResolverMatch = windowReducerText.match(
  /export\s+function\s+resolveModelIncrementalMessages\s*\([\s\S]*?\n}\n/,
);
const mainIncrementalResolverText = mainIncrementalResolverMatch
  ? mainIncrementalResolverMatch[0]
  : "";
if (!mainIncrementalResolverText) {
  fail(
    "main incremental resolver body missing",
    "resolveModelIncrementalMessages must remain explicit so summarized-only filtering can be guarded.",
  );
} else if (
  /\bkeepLatestInjectedOnly\b/.test(mainIncrementalResolverText) ||
  /\bfilterLatestInjectedMessagesByType\b/.test(mainIncrementalResolverText) ||
  /\bfilterInjectedMessagesForDialog\b/.test(mainIncrementalResolverText)
) {
  fail(
    "main incremental resolver compacts injected messages",
    "Latest-only injection selection belongs to summary marking. Model projection must preserve every unsummarized incremental message.",
  );
} else if (
  !/return\s+filterForModelContext\(\s*sourceMessages\s*,\s*policyOptions\s*\)\s*;/.test(mainIncrementalResolverText)
) {
  fail(
    "main incremental resolver drifted from summarized-only filter",
    "resolveModelIncrementalMessages must filter summarized and invalid tool-pair messages without same-type injection compaction.",
  );
} else {
  pass("main incremental preserves every unsummarized injected message");
}

const helpersText = assertFileContains("agent/src/bot/session/model-message-runtime-helpers.js", [
  { name: "uses dual-lane context protocol", pattern: /@noobot\/context-protocol\/dual-lane-context[\s\S]*?buildDualLaneModelContext/ },
  { name: "declares primary context lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.PRIMARY/ },
  { name: "passes authoritative modelContext", pattern: /modelContext:\s*ctx\?\.modelContext/ },
]);
if (helpersText && /ctx\?\.agentContext\?\.payload\?\.messages/.test(helpersText)) {
  if (/includePayloadBlocks/.test(helpersText) && /typeof\s+agentPayloadMessages\s*===\s*["']object["']\s*&&\s*!Array\.isArray\(agentPayloadMessages\)/.test(helpersText)) {
    pass("payload messages are only accepted as structured message blocks for scoped non-main purposes");
  } else {
    fail("payload messages fallback is not block-scoped", "payload.messages must not become a flat compatibility context source.");
  }
}

assertFileContains("agent/src/runtime/turn/turn-executor.js", [
  { name: "main turn uses dual-lane context protocol", pattern: /@noobot\/context-protocol\/dual-lane-context[\s\S]*?buildDualLaneModelContext/ },
  { name: "main turn declares primary lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.PRIMARY/ },
]);

assertFileContains("agent/src/context/index.js", [
  { name: "new-session context resolves session history", pattern: /async\s+buildNewSessionContext[\s\S]*?_resolveSessionRecords/ },
  { name: "existing-session context resolves session history", pattern: /async\s+buildExistingSessionContext[\s\S]*?_resolveSessionRecords/ },
  { name: "context passes current turnScopeId to session history", pattern: /currentTurnScopeId:\s*String\(this\.runConfig\?\.turnScopeId/ },
]);

assertFileContains("agent/src/session/index.js", [
  { name: "session facade uses context payload normalizer", pattern: /function\s+normalizeContextServicePayload[\s\S]*?currentDialogProcessId[\s\S]*?currentTurnScopeId/ },
  { name: "session facade passes normalized payload to getContextRecords", pattern: /async\s+getContextRecords\(payload\s*=\s*\{\}\)[\s\S]*?sessionContextService\.getContextRecords\(\s*normalizeContextServicePayload\(payload\)/ },
]);

assertFileContains("agent/src/session/services/session-context-service.js", [
  { name: "session history delegates scope and projection to protocol", pattern: /createContextScope[\s\S]*?projectContextSource/ },
  { name: "session history exposes one projection", pattern: /async\s+getContextProjection/ },
]);

const messageBuilderText = readFileSync(
  path.join(ROOT, "agent", "src", "context", "assembly", "message-builder.js"),
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
  {
    name: "updates only the final model-message projection",
    pattern: /replaceMessageProjection\(ctx,\s*resolved\)/,
  },
]);

const messageStoreText = assertFileContains("context-protocol/src/message-store.js", [
  { name: "persisted message uid owns canonical entity identity", pattern: /function\s+resolveMessageId[\s\S]*?const\s+persistedMessageUid\s*=\s*String\(message\?\.messageUid[\s\S]*?return\s+canonicalMessageId\s*\|\|\s*persistedMessageUid/ },
  { name: "persisted and context identities cannot diverge", pattern: /canonicalMessageId\s*&&\s*persistedMessageUid\s*&&\s*canonicalMessageId\s*!==\s*persistedMessageUid[\s\S]*?persisted messageUid conflicts with canonical noobotMessageId/ },
  { name: "message-store bumps next id for hydrated ids", pattern: /function\s+bumpNextMessageId[\s\S]*?match\(\s*\/\^am_\(\[0-9a-z\]\+\)\$\/i\s*\)[\s\S]*?store\.nextId\s*=\s*numeric\s*\+\s*1/ },
  { name: "replaceMessages only replaces flat view", pattern: /export\s+function\s+replaceMessages[\s\S]*?holder\.messages\.splice\(0,\s*holder\.messages\.length,\s*\.\.\.canonicalMessages\)[\s\S]*?return\s+holder\.messages/ },
  { name: "messageBlocks deletes old block id views", pattern: /for\s*\(\s*const\s+staleField\s+of\s+\[[\s\S]*?system[\s\S]*?history[\s\S]*?incremental[\s\S]*?delete\s+blocks\[staleField\]/ },
]);
if (messageStoreText) {
  if (/\bbyKey\b|buildMessageKey\b|legacyCandidate\b/.test(messageStoreText)) {
    fail(
      "context protocol still infers identity from message content",
      "Message identity must come only from the persisted messageUid or its equal Context projection id.",
    );
  } else {
    pass("context protocol never infers message identity from content");
  }
  const resolveIdMatch = messageStoreText.match(/function\s+resolveMessageId[\s\S]*?\n}/);
  if (resolveIdMatch && /readField\(message,\s*["'](?:id|messageId)["']\)/.test(resolveIdMatch[0])) {
    fail("message-store accepts a provider or presentation id as canonical identity", "Only persisted messageUid and its equal noobotMessageId projection may own Context identity.");
  } else {
    pass("message-store uses only persisted messageUid and its equal Context projection id");
  }
  const replaceMatch = messageStoreText.match(/export\s+function\s+replaceMessages[\s\S]*?\n}/);
  if (replaceMatch && /canonicalizeMessageStore\(holder\)\s*;[\s\S]*return\s+holder\.messages/.test(replaceMatch[0])) {
    fail("replaceMessages re-canonicalizes blocks after replacing flat messages", "replaceMessages must not rewrite messageBlocks; writeMessageBlocks is the only block mutation path.");
  } else {
    pass("replaceMessages does not rewrite messageBlocks after flat replacement");
  }
}

assertFileContains("agent/src/runtime/hooks/hook-context-builder.js", [
  { name: "hook context accepts only supplied versioned modelContext", pattern: /attachModelContext\(context,\s*modelContext\?\.protocolVersion\s*\?\s*modelContext\s*:\s*null\)/ },
]);

assertFileContains("agent/src/runtime/turn/turn-executor.js", [
  { name: "before_llm hook passes authoritative modelContext", pattern: /const\s+modelContext\s*=\s*requireLoopStateModelContext\(loopState\)[\s\S]*?buildHookContext\(HOOK_POINT\.AGENT\.BEFORE_LLM_CALL[\s\S]*?modelContext,/ },
  { name: "before_llm hook cannot replace authoritative entity", pattern: /assertHookContextRetainsModelContext\(loopState,\s*beforeLlmHookContext\)/ },
]);

assertFileContains("plugin/noobot-plugin-harness/src/capabilities/handlers/shared/model/message-factory.js", [
  { name: "uses dual-lane context protocol", pattern: /@noobot\/context-protocol\/dual-lane-context[\s\S]*?buildDualLaneModelContext/ },
  { name: "declares auxiliary context lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.AUXILIARY/ },
]);

assertFileContains("plugin/noobot-plugin-workflow/src/core/orchestrator/semantic-resolution.js", [
  { name: "uses dual-lane context protocol", pattern: /@noobot\/context-protocol\/dual-lane-context[\s\S]*?buildDualLaneModelContext/ },
  { name: "declares auxiliary context lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.AUXILIARY/ },
  { name: "capability runner receives no second prompt source", pattern: /prompt:\s*["']["']/ },
]);

const loopControlText = assertFileContains("agent/src/runtime/loop-control.js", [
  {
    name: "help tool loop protocol marker",
    pattern: /CONTEXT_INJECTED_MESSAGE_TYPE\.HELP_TOOL_LOOP_PROMPT/,
  },
  {
    name: "help tool loop uses canonical control-message appender",
    pattern: /appendTurnContextControlMessage\(\{[\s\S]{0,500}CONTEXT_INJECTED_MESSAGE_TYPE\.HELP_TOOL_LOOP_PROMPT/,
  },
]);
if (loopControlText) {
  const markerIndex = loopControlText.indexOf("CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT");
  const nearbySource = loopControlText.slice(Math.max(0, markerIndex - 1000), markerIndex + 200);
  if (/new\s+SystemMessage|block:\s*["']system["']/.test(nearbySource)) {
    fail(
      "help tool loop prompt still enters the system block",
      "Runtime control prompts must use the canonical user + incremental control-message protocol.",
    );
  } else {
    pass("help tool loop prompt uses user + incremental control-message protocol");
  }
}

assertFileContains("agent/src/runtime/turn/turn-context-message-appender.js", [
  { name: "control messages persist as user", pattern: /role:\s*["']user["']/ },
  { name: "control messages persist as context_control", pattern: /type:\s*["']context_control["']/ },
  { name: "control messages project as HumanMessage", pattern: /new\s+HumanMessage\s*\(/ },
  { name: "control messages enter incremental block", pattern: /block:\s*["']incremental["']/ },
]);


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
