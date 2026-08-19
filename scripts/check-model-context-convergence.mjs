#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { auditSourcePolicies } from "./quality/model-context-convergence/source-policy-audit.mjs";
import { validateRequestLogOrder } from "./quality/model-context-convergence/request-log-audit.mjs";

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
  if (
    exists(path.join(cwd, "agent", "src")) &&
    exists(path.join(cwd, "plugin", "noobot-plugin-harness", "src"))
  ) {
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
    const ok =
      check.pattern instanceof RegExp
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
if (!sourceFiles.length)
  fail("no source files found for convergence scan", SOURCE_ROOTS.map(rel).join("\n"));

auditSourcePolicies({
  root: ROOT,
  sourceFiles,
  walk,
  relativePath: rel,
  lineOf,
  snippetAt,
  failures,
  fail,
  pass,
});

assertFileContains("context-protocol/src/policy/window.js", [
  {
    name: "history excludes system-like roles",
    pattern: /isSystemLikeMessageRole\(resolveMessageRole\(message\)\)/,
  },
  {
    name: "final order system/history/incremental",
    pattern: /messages:\s*\[\s*\.\.\.system\s*,\s*\.\.\.history\s*,\s*\.\.\.incremental\s*\]/,
  },
  {
    name: "cross-block identity requires canonical message id",
    pattern:
      /const explicitId = resolveMessageId\(message\);[\s\S]*?return explicitId \? `id:\$\{explicitId\}` : ""/,
  },
]);
const messagePolicyText = assertFileContains("context-protocol/src/policy/message.js", [
  {
    name: "message policy delegates canonical identity to codec",
    pattern: /return\s+resolveContextMessageId\(message\)/,
  },
  {
    name: "injected marker delegates to canonical flags",
    pattern: /return\s+resolveContextMessageFlags\(message\)\.injected/,
  },
]);
const policyResolveIdMatch = messagePolicyText.match(
  /export\s+function\s+resolveMessageId[\s\S]*?\n}/,
);
if (
  policyResolveIdMatch &&
  /readMessageField\(message,\s*["'](?:id|messageId)["']\)/.test(policyResolveIdMatch[0])
) {
  fail(
    "message policy accepts a non-canonical identity",
    "Cross-block identity must come only from noobotMessageId.",
  );
} else {
  pass("message policy uses only noobotMessageId as canonical id");
}
assertFileContains("agent/src/bot/session/session-execution-engine-utils.js", [
  {
    name: "model runtime normalization preserves canonical message id",
    pattern: /const noobotMessageId = getMessageId\(messageItem\)[\s\S]*?noobotMessageId/,
  },
  {
    name: "model runtime normalization delegates canonical identity metadata",
    pattern: /projectContextMessageIdentityMetadata\(messageItem\)/,
  },
]);
assertFileContains("context-protocol/src/policy/block.js", [
  {
    name: "owns canonical system/history/incremental composition",
    pattern: /export\s+function\s+buildCanonicalMessageBlocks\b/,
  },
  {
    name: "owns snapshot history grouping identity",
    pattern: /export\s+function\s+createHistoryRoundIdentityResolver\b/,
  },
  {
    name: "owns current-turn history exclusion",
    pattern: /export\s+function\s+filterCurrentTurnMessagesFromHistory\b/,
  },
]);
assertFileContains("context-protocol/src/policy/summary.js", [
  {
    name: "owns summary scope marking",
    pattern: /export\s+function\s+markScopedMessagesSummarized\b/,
  },
  {
    name: "owns latest checkpoint boundary selection",
    pattern: /export\s+function\s+collectLatestCheckpointBoundaryMessageIndexes\b/,
  },
  {
    name: "owns latest checkpoint evidence selection",
    pattern: /export\s+function\s+collectLatestCheckpointEvidenceMessageIndexes\b/,
  },
]);
assertFileContains("context-protocol/src/tool/context-policy.js", [
  {
    name: "owns flow-control semantic classification",
    pattern: /FLOW_CONTROL:\s*"flow_control"/,
  },
  {
    name: "owns checkpoint boundary and evidence roles",
    pattern:
      /CHECKPOINT_BOUNDARY:\s*"checkpoint_boundary"[\s\S]*?CHECKPOINT_EVIDENCE:\s*"checkpoint_evidence"/,
  },
]);
assertFileContains("context-protocol/src/message/codec.js", [
  {
    name: "owns canonical tool-call identity precedence",
    pattern:
      /export\s+function\s+resolveContextToolCallId[\s\S]*?value\?\.tool_call_id[\s\S]*?value\?\.id/,
  },
]);
assertFileContains("context-protocol/src/policy/terminal-history.js", [
  {
    name: "owns terminal history projection",
    pattern: /export\s+function\s+projectTerminalHistoryMessages\b/,
  },
  {
    name: "terminal projection requires canonical round identity",
    pattern: /terminal history status requires dialogProcessId and turnScopeId/,
  },
  {
    name: "terminal projection derives a stable explanation identity",
    pattern: /`\$\{status\.turnScopeId\}::terminal_status`/,
  },
]);
assertFileContains("agent/src/session/services/session-context-service.js", [
  {
    name: "delegates source projection to Context Protocol",
    pattern: /@noobot\/context-protocol[\s\S]*?projectContextSource/,
  },
  {
    name: "reads messages and statuses from one authoritative snapshot",
    pattern: /getSessionContextSource/,
  },
]);
const summaryCheckpointText = assertFileContains(
  "agent/src/bot/session/summary-checkpoint-committer.js",
  [
    {
      name: "summary checkpoint matches canonical ids",
      pattern: /summarizedMessageIds\.has\(resolveMessageId\(message\)\)/,
    },
  ],
);
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
if (
  /markSessionMessagesSummarized/.test(sessionMessageServiceText) ||
  /markSessionMessagesSummarized/.test(sessionFacadeText)
) {
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
assertFileContains(
  "agent/src/session/services/session-message-service/turn-summary-checkpoint.js",
  [
    {
      name: "terminal recovery cannot append messages",
      pattern:
        /isTerminalTurnLifecycleState\(lifecycleTurn\.state\)[\s\S]*?normalizedPersistedUids\.length[\s\S]*?TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE/,
    },
  ],
);
const guidanceSummaryTrackerText = assertFileContains(
  "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/signal-tracker.js",
  [
    {
      name: "guidance checkpoint captures canonical ids",
      pattern: /summaryCheckpointMessageIds\s*=\s*messageIds/,
    },
    {
      name: "guidance checkpoint capture owns incremental only",
      pattern: /const sourceMessages\s*=\s*blocks\.incremental/,
    },
    {
      name: "guidance checkpoint commit owns incremental only",
      pattern: /const coveredMessages\s*=\s*blocks\.incremental/,
    },
    {
      name: "guidance checkpoint rejects unclosed history",
      pattern: /assertSummaryHistoryClosed\(blocks\.history\)/,
    },
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
const messageContextStoreText = assertFileContains(
  "agent/src/runtime/message-context/message-store.js",
  [
    {
      name: "owns tool result LangChain message construction",
      pattern: /new\s+ToolMessage\s*\(/,
    },
    {
      name: "tool result shares persistence identity with model context",
      pattern: /additional_kwargs:\s*\{\s*noobotMessageId:\s*canonicalMessageUid\s*\}/,
    },
    {
      name: "owns canonical incremental model-context mutation",
      pattern: /appendContextMessage\([\s\S]*?\{\s*block:\s*["']incremental["']\s*\}/,
    },
  ],
);
const stateCommitterText = assertFileContains(
  "agent/src/runtime/tool-execution/state-committer.js",
  [
    {
      name: "delegates tool result model message writes to the authoritative port",
      pattern:
        /appendToolResultModelMessage\(\{[\s\S]*?modelContext,[\s\S]*?messageUid,[\s\S]*?\}\)/,
    },
  ],
);
if (
  /@langchain\/core\/messages|\bnew\s+ToolMessage\s*\(|\bappendContextMessage\s*\(/.test(
    stateCommitterText,
  )
) {
  fail(
    "state committer bypasses the authoritative Message Context write port",
    "ToolMessage construction and model-context mutation must remain owned by runtime/message-context/message-store.js.",
  );
} else {
  pass("state committer has no direct model-message construction or mutation path");
}
if (/\bmessages\s*\.\s*(?:push|splice|unshift|shift|pop)\s*\(/.test(stateCommitterText)) {
  fail(
    "state committer retains a flat message-array mutation fallback",
    "Model messages must be written only through the authoritative Message Context port.",
  );
} else {
  pass("state committer has no flat message-array mutation fallback");
}
if (!messageContextStoreText) {
  fail("authoritative Message Context write port is unavailable");
}
assertFileContains("context-protocol/src/policy/snapshot.js", [
  {
    name: "owns snapshot serialization",
    pattern: /export\s+function\s+createModelContextSnapshot\b/,
  },
  { name: "owns snapshot hydration", pattern: /export\s+function\s+hydrateModelContextSnapshot\b/ },
]);
const snapshotPolicyText = readRel("context-protocol/src/policy/snapshot.js");
if (/projectRecoveredMessagesToIdentity/.test(snapshotPolicyText)) {
  fail(
    "snapshot protocol retains an unscoped recovered-message identity projection",
    "Only the stopped incremental block may be projected to a continuation identity.",
  );
} else {
  pass("snapshot protocol has no unscoped recovered-message identity projection");
}
assertFileContains("context-protocol/src/policy/snapshot.js", [
  {
    name: "owns stopped incremental continuation projection",
    pattern: /export\s+function\s+projectSnapshotIncrementalToContinuation\b/,
  },
]);
const stoppedResumePreparerText = assertFileContains(
  "agent/src/bot/session/turn-execution-preparer.js",
  [
    {
      name: "stopped resume loads the authoritative snapshot",
      pattern: /loadStoppedModelMessageSnapshot\s*\(/,
    },
    {
      name: "stopped resume reads snapshot system block",
      pattern: /snapshot\?\.messageBlocks\?\.system/,
    },
    {
      name: "stopped resume reads snapshot history block",
      pattern: /snapshot\?\.messageBlocks\?\.history/,
    },
    {
      name: "stopped resume reads snapshot incremental block",
      pattern: /snapshot\?\.messageBlocks\?\.incremental/,
    },
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
  {
    name: "delegates block strategy to context protocol",
    pattern: /@noobot\/context-protocol\/policy\/block/,
  },
]);
const snapshotStoreText = assertFileContains(
  "agent/src/runtime/resume/model-message-snapshot-store.js",
  [
    {
      name: "delegates snapshot strategy to context protocol",
      pattern: /@noobot\/context-protocol\/policy\/snapshot/,
    },
  ],
);
if (/legacySnapshotPath\b/.test(snapshotStoreText)) {
  fail(
    "stopped snapshot legacy path fallback remains",
    "Stopped snapshots must use the single parent-aware canonical path.",
  );
} else {
  pass("stopped snapshots use one canonical storage path");
}
const turnThresholdsText = readFileSync(path.join(ROOT, "shared", "turn-thresholds.js"), "utf8");
const contextBlocksText = readRel("agent/src/context/assembly/message-builder/context-blocks.js");
const sessionContextText = readRel("agent/src/session/services/session-context-service.js");
const historyLimitUsesTurnThreshold = [contextBlocksText, sessionContextText].every((source) =>
  /TURN_THRESHOLDS\.session\.mainModelHistoryRoundLimit\b/.test(source),
);
const centralHistoryLimitMatch = turnThresholdsText?.match(/mainModelHistoryRoundLimit:\s*(\d+)\b/);
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

const windowReducerText = readRel("context-protocol/src/policy/window.js");
const mainHistoryResolverMatch = windowReducerText.match(
  /export\s+function\s+resolveModelHistoryMessages\s*\([\s\S]*?\n}\n/,
);
const mainHistoryResolverText = mainHistoryResolverMatch ? mainHistoryResolverMatch[0] : "";
if (!mainHistoryResolverText) {
  fail(
    "main history resolver body missing",
    "resolveModelHistoryMessages must remain explicit so complete unsummarized dialog rounds can be guarded.",
  );
} else if (
  /\bkeepLatestInjectedOnly\b|\bfilterLatestInjectedMessagesByType\b|\bfilterInjectedMessagesForDialog\b/.test(
    mainHistoryResolverText,
  )
) {
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
  !/return\s+filterForModelContext\(\s*sourceMessages\s*,\s*policyOptions\s*\)\s*;/.test(
    mainIncrementalResolverText,
  )
) {
  fail(
    "main incremental resolver drifted from summarized-only filter",
    "resolveModelIncrementalMessages must filter summarized and invalid tool-pair messages without same-type injection compaction.",
  );
} else {
  pass("main incremental preserves every unsummarized injected message");
}

const helpersText = assertFileContains("agent/src/bot/session/model-message-runtime-helpers.js", [
  {
    name: "uses dual-lane context protocol",
    pattern: /@noobot\/context-protocol\/assembly\/dual-lane[\s\S]*?buildDualLaneModelContext/,
  },
  { name: "declares primary context lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.PRIMARY/ },
  { name: "passes authoritative modelContext", pattern: /modelContext:\s*ctx\?\.modelContext/ },
]);
if (helpersText && /ctx\?\.agentContext\?\.payload\?\.messages/.test(helpersText)) {
  if (
    /includePayloadBlocks/.test(helpersText) &&
    /typeof\s+agentPayloadMessages\s*===\s*["']object["']\s*&&\s*!Array\.isArray\(agentPayloadMessages\)/.test(
      helpersText,
    )
  ) {
    pass(
      "payload messages are only accepted as structured message blocks for scoped non-main purposes",
    );
  } else {
    fail(
      "payload messages fallback is not block-scoped",
      "payload.messages must not become a flat compatibility context source.",
    );
  }
}

assertFileContains("agent/src/runtime/turn/turn-executor.js", [
  {
    name: "main turn uses dual-lane context protocol",
    pattern: /@noobot\/context-protocol\/assembly\/dual-lane[\s\S]*?buildDualLaneModelContext/,
  },
  { name: "main turn declares primary lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.PRIMARY/ },
]);

assertFileContains("agent/src/context/index.js", [
  {
    name: "new-session context resolves session history",
    pattern: /async\s+buildNewSessionContext[\s\S]*?_resolveSessionRecords/,
  },
  {
    name: "existing-session context resolves session history",
    pattern: /async\s+buildExistingSessionContext[\s\S]*?_resolveSessionRecords/,
  },
  {
    name: "context passes current turnScopeId to session history",
    pattern: /currentTurnScopeId:\s*String\(this\.runConfig\?\.turnScopeId/,
  },
]);

assertFileContains("agent/src/session/index.js", [
  {
    name: "session facade uses context payload normalizer",
    pattern:
      /function\s+normalizeContextServicePayload[\s\S]*?currentDialogProcessId[\s\S]*?currentTurnScopeId/,
  },
  {
    name: "session facade passes normalized payload to getContextRecords",
    pattern:
      /async\s+getContextRecords\(payload\s*=\s*\{\}\)[\s\S]*?sessionContextService\.getContextRecords\(\s*normalizeContextServicePayload\(payload\)/,
  },
]);

assertFileContains("agent/src/session/services/session-context-service.js", [
  {
    name: "session history delegates scope and projection to protocol",
    pattern: /createContextScope[\s\S]*?projectContextSource/,
  },
  { name: "session history exposes one projection", pattern: /async\s+getContextProjection/ },
]);

const messageBuilderText = readFileSync(
  path.join(ROOT, "agent", "src", "context", "assembly", "message-builder.js"),
  "utf8",
);
if (
  /\bsameCurrentText\b/.test(messageBuilderText) ||
  /String\(\s*msg\?\.content\s*\|\|\s*["']["']\s*\)\.trim\(\)\s*===\s*normalizedCurrentUserMessage/.test(
    messageBuilderText,
  )
) {
  fail(
    "history filtering by current user text found",
    "Repeated goals such as “下一步” must not delete previous dialogProcessId history rounds; only current turn/dialog ids may be filtered.",
  );
} else {
  pass("history filtering does not drop previous rounds by repeated user text");
}

assertFileContains("plugin/noobot-plugin-harness/src/core/model-message-context.js", [
  {
    name: "harness before_llm_call delegates to resolver",
    pattern: /applyAgentResolvedModelMessages/,
  },
  { name: "uses injected resolveModelMessages", pattern: /resolveModelMessages/ },
  {
    name: "updates only the final model-message projection",
    pattern: /replaceMessageProjection\(ctx,\s*resolved\)/,
  },
]);

const messageStoreText = assertFileContains("context-protocol/src/message/store.js", [
  {
    name: "persisted message uid owns canonical entity identity",
    pattern:
      /function\s+resolveMessageId[\s\S]*?const\s+persistedMessageUid\s*=\s*String\(message\?\.messageUid[\s\S]*?return\s+canonicalMessageId\s*\|\|\s*persistedMessageUid/,
  },
  {
    name: "persisted and context identities cannot diverge",
    pattern:
      /canonicalMessageId\s*&&\s*persistedMessageUid\s*&&\s*canonicalMessageId\s*!==\s*persistedMessageUid[\s\S]*?persisted messageUid conflicts with canonical noobotMessageId/,
  },
  {
    name: "message-store bumps next id for hydrated ids",
    pattern:
      /function\s+bumpNextMessageId[\s\S]*?match\(\s*\/\^am_\(\[0-9a-z\]\+\)\$\/i\s*\)[\s\S]*?store\.nextId\s*=\s*numeric\s*\+\s*1/,
  },
  {
    name: "replaceMessages only replaces flat view",
    pattern:
      /export\s+function\s+replaceMessages[\s\S]*?holder\.messages\.splice\(0,\s*holder\.messages\.length,\s*\.\.\.canonicalMessages\)[\s\S]*?return\s+holder\.messages/,
  },
  {
    name: "messageBlocks deletes old block id views",
    pattern:
      /for\s*\(\s*const\s+staleField\s+of\s+\[[\s\S]*?system[\s\S]*?history[\s\S]*?incremental[\s\S]*?delete\s+blocks\[staleField\]/,
  },
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
  if (
    resolveIdMatch &&
    /readField\(message,\s*["'](?:id|messageId)["']\)/.test(resolveIdMatch[0])
  ) {
    fail(
      "message-store accepts a provider or presentation id as canonical identity",
      "Only persisted messageUid and its equal noobotMessageId projection may own Context identity.",
    );
  } else {
    pass("message-store uses only persisted messageUid and its equal Context projection id");
  }
  const replaceMatch = messageStoreText.match(/export\s+function\s+replaceMessages[\s\S]*?\n}/);
  if (
    replaceMatch &&
    /canonicalizeMessageStore\(holder\)\s*;[\s\S]*return\s+holder\.messages/.test(replaceMatch[0])
  ) {
    fail(
      "replaceMessages re-canonicalizes blocks after replacing flat messages",
      "replaceMessages must not rewrite messageBlocks; writeMessageBlocks is the only block mutation path.",
    );
  } else {
    pass("replaceMessages does not rewrite messageBlocks after flat replacement");
  }
}

assertFileContains("agent/src/runtime/hooks/hook-context-builder.js", [
  {
    name: "hook context accepts only supplied versioned modelContext",
    pattern:
      /attachModelContext\(context,\s*modelContext\?\.protocolVersion\s*\?\s*modelContext\s*:\s*null\)/,
  },
]);

assertFileContains("agent/src/runtime/turn/turn-executor.js", [
  {
    name: "before_llm hook passes authoritative modelContext",
    pattern:
      /const\s+modelContext\s*=\s*requireLoopStateModelContext\(loopState\)[\s\S]*?buildHookContext\(HOOK_POINT\.AGENT\.BEFORE_LLM_CALL[\s\S]*?modelContext,/,
  },
  {
    name: "before_llm hook cannot replace authoritative entity",
    pattern: /assertHookContextRetainsModelContext\(loopState,\s*beforeLlmHookContext\)/,
  },
]);

assertFileContains(
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/model/message-factory.js",
  [
    {
      name: "uses dual-lane context protocol",
      pattern: /@noobot\/context-protocol\/assembly\/dual-lane[\s\S]*?buildDualLaneModelContext/,
    },
    { name: "declares auxiliary context lane", pattern: /lane:\s*MODEL_CONTEXT_LANE\.AUXILIARY/ },
  ],
);

assertFileContains("plugin/noobot-plugin-workflow/src/core/orchestrator/semantic-resolution.js", [
  {
    name: "uses dual-lane context protocol",
    pattern: /@noobot\/context-protocol\/assembly\/dual-lane[\s\S]*?buildDualLaneModelContext/,
  },
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
    pattern:
      /appendTurnContextControlMessage\(\{[\s\S]{0,500}CONTEXT_INJECTED_MESSAGE_TYPE\.HELP_TOOL_LOOP_PROMPT/,
  },
]);
if (loopControlText) {
  const markerIndex = loopControlText.indexOf(
    "CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT",
  );
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
  {
    name: "control messages persist as context_control",
    pattern: /type:\s*["']context_control["']/,
  },
  { name: "control messages project as HumanMessage", pattern: /new\s+HumanMessage\s*\(/ },
  { name: "control messages enter incremental block", pattern: /block:\s*["']incremental["']/ },
]);

for (const logPath of process.argv.slice(2)) {
  validateRequestLogOrder(logPath, { fail, pass });
}

if (failures.length) {
  console.error("[check-model-context-convergence] FAILED");
  console.error(
    "Invariant: model messages must be resolved centrally as system -> history -> incremental.\n",
  );
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
