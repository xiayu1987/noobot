/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const INJECTED_COMPACTION =
  /\bkeepLatestInjectedOnly\b|\bfilterLatestInjectedMessagesByType\b|\bfilterInjectedMessagesForDialog\b/;

export const PROTOCOL_CONTRACTS = Object.freeze([
  {
    file: "context-protocol/src/policy/window.js",
    required: [
      ["history excludes system-like roles", /isContextSystemMessage\(message\)/],
      [
        "final order system/history/incremental",
        /messages:\s*\[\s*\.\.\.system\s*,\s*\.\.\.history\s*,\s*\.\.\.incremental\s*\]/,
      ],
      [
        "cross-block identity requires canonical message id",
        /const explicitId = resolveContextMessageId\(message\);[\s\S]*?return explicitId \? `id:\$\{explicitId\}` : ""/,
      ],
      [
        "block resolver applies only the summarized-message filter",
        /function\s+resolveModelBlockMessages[\s\S]*?return\s+filterForModelContext\(\s*sourceMessages\s*,\s*policyOptions\s*\)\s*;/,
      ],
    ],
    scoped: [
      {
        scope: { fn: "resolveModelHistoryMessages" },
        forbidden: [["main history resolver compacts injected messages", INJECTED_COMPACTION]],
      },
      {
        scope: { fn: "resolveModelIncrementalMessages" },
        required: [
          [
            "main incremental delegates to the block resolver",
            /return\s+resolveModelBlockMessages\(options\)\s*;/,
          ],
        ],
        forbidden: [["main incremental resolver compacts injected messages", INJECTED_COMPACTION]],
      },
    ],
  },
  {
    file: "context-protocol/src/policy/message.js",
    required: [
      [
        "injected marker delegates to canonical flags",
        /return\s+resolveContextMessageFlags\(message\)\.injected/,
      ],
    ],
    forbidden: [
      [
        "message policy re-exports codec accessors under aliases",
        /\bexport\s*\{[^}]*\bas\b[^}]*\}\s*from\s*["']\.\.\/message\/codec\.js["']/,
      ],
    ],
  },
  {
    file: "context-protocol/src/policy/block.js",
    required: [
      [
        "owns canonical system/history/incremental composition",
        /export\s+function\s+buildCanonicalMessageBlocks\b/,
      ],
      [
        "owns current-turn history exclusion",
        /export\s+function\s+filterCurrentTurnMessagesFromHistory\b/,
      ],
    ],
  },
  {
    file: "context-protocol/src/policy/summary.js",
    required: [
      ["owns summary scope marking", /export\s+function\s+markScopedMessagesSummarized\b/],
      [
        "owns latest checkpoint boundary selection",
        /export\s+function\s+collectLatestCheckpointBoundaryMessageIndexes\b/,
      ],
      [
        "owns latest checkpoint evidence selection",
        /export\s+function\s+collectLatestCheckpointEvidenceMessageIndexes\b/,
      ],
    ],
  },
  {
    file: "context-protocol/src/tool/context-policy.js",
    required: [
      ["owns flow-control semantic classification", /FLOW_CONTROL:\s*"flow_control"/],
      [
        "owns checkpoint boundary and evidence roles",
        /CHECKPOINT_BOUNDARY:\s*"checkpoint_boundary"[\s\S]*?CHECKPOINT_EVIDENCE:\s*"checkpoint_evidence"/,
      ],
    ],
  },
  {
    file: "context-protocol/src/message/codec.js",
    required: [
      [
        "persisted message uid owns canonical entity identity",
        /export\s+function\s+resolveContextMessageId\(message = \{\}\) \{\s*return readContextMessageField\(message, "messageUid"\);\s*\}/,
      ],
      [
        "owns tool-call declaration identity",
        /export\s+function\s+resolveContextToolCallDeclarationId\(call = \{\}\) \{\s*return text\(call\?\.id\);\s*\}/,
      ],
      [
        "owns tool-result call identity",
        /export\s+function\s+resolveContextToolResultCallId\(message = \{\}\) \{\s*return text\(message\?\.tool_call_id\);\s*\}/,
      ],
    ],
    scoped: [
      {
        scope: { fn: "resolveContextMessageId" },
        forbidden: [
          [
            "codec accepts a provider or presentation id as canonical identity",
            /readContextMessageField\(message,\s*["'](?:id|messageId)["']\)|message\?\.messageId\b/,
          ],
        ],
      },
    ],
  },
  {
    file: "context-protocol/src/policy/terminal-history.js",
    required: [
      ["owns terminal history projection", /export\s+function\s+projectTerminalHistoryMessages\b/],
      [
        "terminal projection requires canonical round identity",
        /terminal history status requires dialogProcessId and turnScopeId/,
      ],
      [
        "terminal projection derives a stable explanation identity",
        /deriveContextMessageProjectionId\(\s*status\.turnScopeId,\s*CONTEXT_MESSAGE_PROJECTION_TYPE\.TERMINAL_STATUS,?\s*\)/,
      ],
    ],
  },
  {
    file: "context-protocol/src/policy/snapshot.js",
    required: [
      ["owns snapshot serialization", /export\s+function\s+createModelContextSnapshot\b/],
      ["owns snapshot hydration", /export\s+function\s+hydrateModelContextSnapshot\b/],
      [
        "owns stopped incremental continuation projection",
        /export\s+function\s+projectSnapshotIncrementalToContinuation\b/,
      ],
    ],
    forbidden: [
      [
        "snapshot protocol retains an unscoped recovered-message identity projection",
        /projectRecoveredMessagesToIdentity/,
      ],
    ],
  },
  {
    file: "context-protocol/src/message/store.js",
    required: [
      [
        "replaceMessages only replaces flat view",
        /export\s+function\s+replaceMessages[\s\S]*?holder\.messages\.splice\(0,\s*holder\.messages\.length,\s*\.\.\.canonicalMessages\)[\s\S]*?return\s+holder\.messages/,
      ],
      [
        "messageBlocks deletes old block id views",
        /for\s*\(\s*const\s+staleField\s+of\s+\[[\s\S]*?system[\s\S]*?history[\s\S]*?incremental[\s\S]*?delete\s+blocks\[staleField\]/,
      ],
    ],
    forbidden: [
      [
        "context protocol infers identity from message content",
        /\bbyKey\b|buildMessageKey\b|legacyCandidate\b/,
      ],
      ["message-store reimplements message identity", /function\s+resolveMessageId\b/],
    ],
    scoped: [
      {
        scope: { fn: "replaceMessages" },
        forbidden: [
          [
            "replaceMessages re-canonicalizes blocks after replacing flat messages",
            /canonicalizeMessageStore\(holder\)\s*;[\s\S]*return\s+holder\.messages/,
          ],
        ],
      },
    ],
  },
  {
    file: "shared/turn-thresholds.js",
    required: [
      [
        "main model history round limit is a central positive integer",
        /mainModelHistoryRoundLimit:\s*[1-9]\d*\b/,
      ],
    ],
  },
]);
