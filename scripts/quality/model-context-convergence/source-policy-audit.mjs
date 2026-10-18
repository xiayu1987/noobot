/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXEMPTION_KINDS } from "../check-protocol.mjs";
import {
  addExemptablePatternOffsetHits,
  addPatternOffsetHits,
  escapeRegExp,
} from "../boundary-hits.mjs";

const SUMMARY_POLICY_PATH = "context-protocol/src/policy/summary.js";

const LEGACY_SOURCE_PATTERNS = Object.freeze([
  [
    "legacy context/message-block compatibility helper",
    /\b(resolveMessageBlock|composeFinalMessageBlocks|applyMessageBlocksForBeforeLlmCall|resolveFinalMessageBlocks|collectPayloadMessages|resolveContextSourceMessages|includePayloadMessages|shouldUsePayloadMessageFallback|resolveAgentModelMessages|misplacedSystemMessages)\b/g,
    "删掉旧的上下文兼容/拼装路径，只保留 agent message-store resolver。",
  ],
  [
    "flat ctx.messages fallback in model resolver",
    /Array\.isArray\(\s*ctx\?\.messages\s*\)\s*&&\s*ctx\.messages\.length/g,
    "不要从 ctx.messages 做隐式 fallback；主链路必须使用 messageBlocks/system-history-incremental。",
  ],
  [
    "tail system message after existing messages",
    /\[\s*\.\.\.[^\]]{0,500},\s*\{\s*role:\s*["'](?:system|developer)["']/gs,
    "system/developer 类消息必须在大顺序最前面，不能 append 到已有 messages 后面。",
  ],
  [
    "runtimeMessages tail system assignment",
    /runtimeMessages\s*=\s*\[\s*\.\.\.runtimeMessages\s*,\s*\{\s*role:\s*["'](?:system|developer)["']/gs,
    "reasoning/retry 等运行时 system/developer 消息必须 prepend 或写入 system block。",
  ],
  [
    "system message written to incremental block",
    /appendMessage\s*\([\s\S]{0,500}(?:role:\s*["'](?:system|developer)["']|new\s+SystemMessage\s*\()[\s\S]{0,500}block:\s*["']incremental["']/g,
    "role=system/developer/SystemMessage 必须写入 system block，不能写入 incremental。",
  ],
  [
    "message block id view used as context source",
    /\b(?:systemIds|historyIds|incrementalIds|resolveBlockMessagesByIds)\b/g,
    "上下文分块唯一事实源只能是 messageBlocks.system/history/incremental 数组，不能再保留 blockIds 第二事实源。",
  ],
  [
    "injected message type inferred from content",
    /\b(?:recognizeContent|resolveContentType|isPluginRelayContent|resolvePluginRelayInjectedMessageType|isInjectedMessageLike)\b/g,
    "注入消息只能使用 injectedMessage/injectedBy/injectedMessageType 协议字段，禁止从内容前缀推断。",
  ],
  [
    "tool-name-driven summary retention contract",
    /\b(?:DEFAULT_TASK_SUMMARY_TOOL_NAME|DEFAULT_TASK_CHECK_TOOL_NAME|taskSummaryToolName|taskCheckToolName|collectLatestTaskSummaryMessageIndexes|collectLatestTaskCheckMessageIndexes)\b/g,
    "小结保留只能使用 Context Protocol 的 flow-control 分类，具体工具名只属于 Agent 业务执行。",
  ],
  [
    "tool identity inferred from result content",
    /\bresolveContextToolName\b/g,
    "工具身份必须来自显式调用协议，禁止解析工具结果正文推导身份。",
  ],
]);

const OWNERSHIP_PATTERNS = Object.freeze({
  latestInjectedRetention:
    /\b(?:keepLatestInjectedOnly|filterLatestInjectedMessagesByType|filterInjectedMessagesForDialog|collectLatestInjectedMessageIndexes)\b/g,
  summarizedWrite: /summarized\s*(?:=|:)\s*true/g,
  summaryMutationCall:
    /\b(?:markContextMessageSummarized|markCurrentTurn(?:Store|Array|ModelMessages)Summarized|markScopedMessagesSummarized|markMessagesSummarizedByIds)\s*\(/g,
  messageIdFallback:
    /\bmessageId\b[^;\n]{0,160}?(?:\|\||\?\?)[^;\n]{0,160}?\bmessageUid\b|\bmessageUid\b[^;\n]{0,160}?(?:\|\||\?\?)[^;\n]{0,160}?\bmessageId\b|\bfunction\s+canonicalMessageId\b/g,
});

const LEGACY_WINDOW_TOKENS = Object.freeze(
  [
    ["contextWindow", "RecentMessageLimit"],
    ["incremental", "RecentMessageLimit"],
    ["recentWindow", "MessageLimit"],
    ["nonMainContextWindow", "RecentMessageLimit"],
    ["mainModel", "RecentLimit"],
    ["mainModel", "RecentWindow"],
    ["session", "RecentMessageLimit"],
    ["recent", "MessageLimit"],
    ["normalize", "RecentWindow"],
    ["resolve", "ModelContextMessages"],
    ["use", "RecentWindow"],
    ["recent", "Limit"],
    ["最近 ", "20"],
    ["20 ", "条"],
  ].map((parts) => parts.join("")),
);

export const SOURCE_POLICY_RULES = Object.freeze({
  legacySourcePattern: {
    description:
      "Model context assembly has no legacy compatibility, tail-system or inferred-identity path",
    hint: "follow the per-hit advice; resolve messages only through messageBlocks system -> history -> incremental",
  },
  latestInjectedRetention: {
    description:
      "Latest injected-message retention exists only in summary and terminal-history policies",
    hint: "call the context-protocol summary or terminal-history policy instead of compacting locally",
  },
  summarizedWrite: {
    description:
      "summarized=true is written only by summary policy, checkpoint persistence and snapshot hydration",
    hint: "request the UID checkpoint transaction instead of marking messages summarized",
  },
  summaryMutationCall: {
    description:
      "Summary mutation APIs are called only by checkpoint commit and completed-turn finalization",
    hint: "route summary marking through summary-checkpoint-committer or turn completion",
  },
  messageIdFallback: {
    description: "messageId/messageUid identity fallback is owned by the session message entity",
    hint: "resolve identity with codec resolveContextMessageId or the session message entity",
  },
  legacyWindowMarker: {
    description: "No fixed-size recent-message context window remains",
    hint: "use TURN_THRESHOLDS.session.mainModelHistoryRoundLimit dialog rounds",
  },
});

function ownershipExemption(rule, reason, match) {
  return { id: `${rule}-owners`, kind: EXEMPTION_KINDS.PATH_PREFIX, rules: [rule], reason, match };
}

export const SOURCE_POLICY_EXEMPTIONS = Object.freeze([
  ownershipExemption(
    "summarizedWrite",
    "summary policy, the codec flag writer and checkpoint persistence own summarized writes",
    [
      SUMMARY_POLICY_PATH,
      "context-protocol/src/message/codec.js",
      "agent/src/bot/session/summary-checkpoint-committer.js",
      "agent/src/session/services/session-message-service/turn-summary-checkpoint.js",
    ],
  ),
  ownershipExemption(
    "summaryMutationCall",
    "summary mutation APIs are defined in context-protocol and called by checkpoint commit and turn completion",
    [
      SUMMARY_POLICY_PATH,
      "context-protocol/src/message/codec.js",
      "context-protocol/src/message/store.js",
      "context-protocol/src/mutation/context.js",
      "context-protocol/src/policy/snapshot.js",
      "context-protocol/src/policy/turn-completion.js",
      "agent/src/bot/session/summary-checkpoint-committer.js",
    ],
  ),
]);

export function addSourcePolicyHits({ usage, measured, file, source }) {
  for (const [name, pattern, advice] of LEGACY_SOURCE_PATTERNS) {
    const measurement = measured.legacySourcePattern;
    addPatternOffsetHits({ measurement, file, source, pattern, message: `${name}; ${advice}` });
  }
  for (const [rule, pattern] of Object.entries(OWNERSHIP_PATTERNS)) {
    const message = SOURCE_POLICY_RULES[rule].description;
    const measurement = measured[rule];
    addExemptablePatternOffsetHits({ usage, rule, measurement, file, source, pattern, message });
  }
}

const LEGACY_WINDOW_PATTERN = new RegExp(LEGACY_WINDOW_TOKENS.map(escapeRegExp).join("|"), "g");

export function addLegacyWindowHits({ measured, file, source }) {
  addPatternOffsetHits({
    measurement: measured.legacyWindowMarker,
    file,
    source,
    pattern: LEGACY_WINDOW_PATTERN,
    message: "legacy fixed-size context window marker",
  });
}
