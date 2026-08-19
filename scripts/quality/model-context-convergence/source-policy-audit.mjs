/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SUMMARY_POLICY_PATH = "context-protocol/src/policy/summary.js";

function collectHits({ files, relativePath, pattern, excluded = new Set() }) {
  const hits = [];
  for (const file of files) {
    const filePath = relativePath(file);
    if (excluded.has(filePath)) continue;
    const text = readFileSync(file, "utf8");
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      hits.push({ file: filePath, index: match.index, token: match[0], text });
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }
  return hits;
}

function reportOwnership({ title, success, hits, lineOf, fail, pass, includeToken = true }) {
  if (!hits.length) {
    pass(success);
    return;
  }
  fail(
    title,
    hits
      .slice(0, 12)
      .map(
        (item) =>
          `  ${item.file}:${lineOf(item.text, item.index)}${includeToken ? ` ${item.token}` : ""}`,
      )
      .join("\n"),
  );
}

function auditLegacyWindows({ root, walk, relativePath, lineOf, fail, pass }) {
  const files = [
    ["agent", "src"],
    ["agent", "__tests__"],
    ["plugin", "noobot-plugin-harness", "src"],
    ["plugin", "noobot-plugin-harness", "__tests__"],
    ["shared"],
    ["docs"],
  ].flatMap((parts) => walk(path.join(root, ...parts)));
  const tokens = [
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
  ].map((parts) => parts.join(""));
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const token of tokens) {
      let index = text.indexOf(token);
      while (index >= 0) {
        hits.push({ file: relativePath(file), text, token, index });
        index = text.indexOf(token, index + token.length);
      }
    }
  }
  reportOwnership({
    title: "legacy fixed-size non-main context window markers found",
    success: "no legacy fixed-size non-main context window markers",
    hits,
    lineOf,
    fail,
    pass,
  });

  const serviceText = readFileSync(
    path.join(root, "agent", "src", "session", "services", "session-context-service.js"),
    "utf8",
  );
  const recordsText =
    serviceText.match(/async\s+getContextRecords\s*\([\s\S]*?\n\s*\}\n\s*\}/)?.[0] || "";
  if (
    /getMessagesSinceLast(?:Running|Completed)Task/.test(serviceText) ||
    /useLast(?:Running|Completed)TaskRange/.test(recordsText)
  ) {
    fail(
      "task-range session context branch found",
      "Model context must resolve main-model history via latest dialog groups only.",
    );
  } else {
    pass("session context has no task-range context branches");
  }
}

function auditForbiddenPatterns({ files, relativePath, lineOf, snippetAt, failures, fail, pass }) {
  const checks = [
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
  ];
  for (const [name, pattern, advice] of checks) {
    const hits = collectHits({ files, relativePath, pattern });
    for (const [file, fileHits] of Map.groupBy(hits, (item) => item.file)) {
      const detail = fileHits
        .slice(0, 8)
        .map(
          (item) =>
            `  ${file}:${lineOf(item.text, item.index)} ${snippetAt(item.text, item.index)}`,
        )
        .join("\n");
      fail(`${name}: ${file}`, `${detail}\n${advice}`);
    }
  }
  const successChecks = [
    [
      "legacy context/message-block compatibility helper",
      "no legacy context compatibility helpers in source",
    ],
    ["flat ctx.messages fallback", "no flat ctx.messages fallback in resolver source"],
    ["tail system", "no known tail-system append patterns in source"],
    [
      "system message written to incremental",
      "no known system-to-incremental append pattern in source",
    ],
    [
      "injected message type inferred from content",
      "injected message classification never falls back to content",
    ],
  ];
  for (const [failureTitle, success] of successChecks) {
    if (!failures.some((item) => item.title.includes(failureTitle))) pass(success);
  }
}

function auditSummaryOwnership({ files, relativePath, lineOf, fail, pass }) {
  const policies = [
    {
      title: "latest injected-message retention escaped summary or terminal-history policy",
      success:
        "latest injected-message retention exists only in summary and terminal-history policies",
      pattern:
        /\b(?:keepLatestInjectedOnly|filterLatestInjectedMessagesByType|filterInjectedMessagesForDialog|collectLatestInjectedMessageIndexes)\b/g,
      excluded: [SUMMARY_POLICY_PATH, "context-protocol/src/policy/terminal-history.js"],
    },
    {
      title: "summarized state mutation exists outside canonical summary ownership",
      success:
        "summarized writes are restricted to summary policy, checkpoint persistence, and snapshot hydration",
      pattern: /summarized\s*(?:=|:)\s*true/g,
      includeToken: false,
      excluded: [
        SUMMARY_POLICY_PATH,
        "context-protocol/src/message/store.js",
        "context-protocol/src/mutation/context.js",
        "context-protocol/src/policy/snapshot.js",
        "agent/src/runtime/resume/model-message-snapshot-store.js",
        "agent/src/bot/session/summary-checkpoint-committer.js",
        "agent/src/session/services/session-message-service/turn-summary-checkpoint.js",
      ],
    },
    {
      title: "summary mutation API called outside the three authoritative flows",
      success:
        "summary mutation API is restricted to checkpoint commit and completed-turn finalization",
      pattern:
        /\b(?:markCurrentTurn(?:Store|Array|ModelMessages)Summarized|markScopedMessagesSummarized|markMessagesSummarizedByIds)\s*\(/g,
      excluded: [
        SUMMARY_POLICY_PATH,
        "context-protocol/src/message/store.js",
        "context-protocol/src/mutation/context.js",
        "context-protocol/src/policy/turn-completion.js",
        "agent/src/runtime/turn/turn-result-aggregator.js",
        "agent/src/bot/session/summary-checkpoint-committer.js",
      ],
    },
  ];
  for (const policy of policies) {
    const hits = collectHits({
      files,
      relativePath,
      pattern: policy.pattern,
      excluded: new Set(policy.excluded),
    });
    reportOwnership({ ...policy, hits, lineOf, fail, pass });
  }
}

export function auditSourcePolicies(context) {
  auditLegacyWindows(context);
  auditForbiddenPatterns({ ...context, files: context.sourceFiles });
  auditSummaryOwnership({ ...context, files: context.sourceFiles });
}
