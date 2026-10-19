/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const DUAL_LANE_IMPORT =
  /@noobot\/context-protocol\/assembly\/dual-lane[\s\S]*?buildDualLaneModelContext/;
const AUXILIARY_LANE = /lane:\s*MODEL_CONTEXT_LANE\.AUXILIARY/;
const PRIMARY_LANE = /lane:\s*MODEL_CONTEXT_LANE\.PRIMARY/;
const HISTORY_ROUND_LIMIT = /TURN_THRESHOLDS\.session\.mainModelHistoryRoundLimit\b/;
const SUMMARIZED_PORT = /markSessionMessagesSummarized/;
const HELP_LOOP_MARKER = "CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT";

export const AGENT_CONTRACTS = Object.freeze([
  {
    file: "agent/src/session/entities/message-entity.js",
    required: [
      [
        "session message entity owns messageUid default identity",
        /function resolveRuntimeMessageId\([^)]*\)\s*\{\s*return firstText\(\s*message\?\.messageId,\s*readContextMessageField\(message, "noobotMessageId"\),\s*messageUid,?\s*\);/,
      ],
    ],
  },
  {
    file: "agent/src/context/assembly/message-builder/history.js",
    required: [
      [
        "history assembly delegates canonical identity metadata",
        /additional_kwargs:\s*projectContextMessageIdentityMetadata\(msg\)/,
      ],
    ],
  },
  {
    file: "agent/src/session/services/session-context-service.js",
    required: [
      [
        "delegates source projection to Context Protocol",
        /@noobot\/context-protocol[\s\S]*?projectContextSource/,
      ],
      ["reads messages and statuses from one authoritative snapshot", /getSessionContextSource/],
      [
        "session history delegates scope and projection to protocol",
        /createContextScope[\s\S]*?projectContextSource/,
      ],
      ["session history exposes one projection", /async\s+getContextProjection/],
      ["history projection uses the central round limit", HISTORY_ROUND_LIMIT],
    ],
    forbidden: [
      [
        "task-range session context branch",
        /getMessagesSinceLast(?:Running|Completed)Task|useLast(?:Running|Completed)TaskRange/,
      ],
    ],
  },
  {
    file: "agent/src/bot/session/summary-checkpoint-committer.js",
    required: [
      [
        "summary checkpoint matches canonical ids",
        /summarizedMessageIds\.has\(resolveContextMessageId\(message\)\)/,
      ],
    ],
    forbidden: [
      [
        "summary checkpoint contains a non-canonical identity path",
        /buildMessageIdentity|remainingByIdentity|summarizedMessages/,
      ],
    ],
  },
  {
    file: "agent/src/session/services/session-message-service.js",
    forbidden: [["direct session summarized-message mutation port", SUMMARIZED_PORT]],
  },
  {
    file: "agent/src/session/index.js",
    required: [
      [
        "session facade uses context payload normalizer",
        /function\s+normalizeContextServicePayload[\s\S]*?currentDialogProcessId[\s\S]*?currentTurnScopeId/,
      ],
      [
        "session facade passes normalized payload to getContextProjection",
        /async\s+getContextProjection\(payload\s*=\s*\{\}\)[\s\S]*?sessionContextService\.getContextProjection\(\s*normalizeContextServicePayload\(payload\)/,
      ],
    ],
    forbidden: [["direct session summarized-message mutation port", SUMMARIZED_PORT]],
  },
  {
    file: "agent/src/tools/collaboration/task-summary-tool.js",
    forbidden: [
      [
        "task_summary mutates summarized state before checkpoint commit",
        /markCurrentTurn(?:Store|ModelMessages|Array)Summarized/,
      ],
    ],
  },
  {
    file: "agent/src/session/services/session-message-service/turn-summary-checkpoint.js",
    required: [
      [
        "terminal recovery cannot append messages",
        /isTerminalTurnLifecycleState\(lifecycleTurn\.state\)[\s\S]*?request\.persistedMessageUids\.length[\s\S]*?TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE/,
      ],
    ],
  },
  {
    file: "plugin/noobot-plugin-harness/src/capabilities/handlers/guidance/signal-tracker.js",
    required: [
      [
        "guidance checkpoint captures canonical ids",
        /summaryCheckpointMessageIds\s*=\s*messageIds/,
      ],
      ["guidance checkpoint capture delegates scope to protocol", /resolveSummaryScope\(blocks\)/],
    ],
    forbidden: [
      ["guidance summary redefines protocol history closure", /assertSummaryHistoryClosed/],
      ["guidance summary checkpoint retains a count-based scope", /summaryCheckpointMessageCount/],
    ],
  },
  {
    file: "agent/src/runtime/message-context/message-store.js",
    required: [
      ["owns tool result LangChain message construction", /new\s+ToolMessage\s*\(/],
      [
        "tool result shares persistence identity with model context",
        /additional_kwargs:\s*\{\s*noobotMessageId:\s*canonicalMessageUid\s*\}/,
      ],
      [
        "owns canonical incremental model-context mutation",
        /appendContextMessage\([\s\S]*?\{\s*block:\s*["']incremental["']\s*\}/,
      ],
    ],
  },
  {
    file: "agent/src/runtime/tool-execution/state-committer.js",
    required: [
      [
        "delegates tool result model message writes to the authoritative port",
        /appendToolResultModelMessage\(\{[\s\S]*?modelContext,[\s\S]*?messageUid,[\s\S]*?\}\)/,
      ],
    ],
    forbidden: [
      [
        "state committer bypasses the authoritative Message Context write port",
        /@langchain\/core\/messages|\bnew\s+ToolMessage\s*\(|\bappendContextMessage\s*\(/,
      ],
      [
        "state committer retains a flat message-array mutation fallback",
        /\bmessages\s*\.\s*(?:push|splice|unshift|shift|pop)\s*\(/,
      ],
    ],
  },
  {
    file: "agent/src/bot/session/turn-execution-preparer.js",
    required: [
      ["stopped resume loads the authoritative snapshot", /loadStoppedModelMessageSnapshot\s*\(/],
      ["stopped resume reads snapshot system block", /snapshot\?\.messageBlocks\?\.system/],
      ["stopped resume reads snapshot history block", /snapshot\?\.messageBlocks\?\.history/],
      [
        "stopped resume reads snapshot incremental block",
        /snapshot\?\.messageBlocks\?\.incremental/,
      ],
    ],
    forbidden: [
      [
        "stopped snapshot resume rebuilds blocks from Session history",
        /projectTerminalHistoryMessages|getContextRecords|buildExistingSessionContext|buildContinueContext/,
      ],
    ],
  },
  {
    file: "agent/src/context/assembly/message-builder/context-blocks.js",
    required: [
      ["delegates block strategy to context protocol", /@noobot\/context-protocol\/policy\/block/],
      ["history projection uses the central round limit", HISTORY_ROUND_LIMIT],
    ],
  },
  {
    file: "agent/src/runtime/resume/model-message-snapshot-store.js",
    required: [
      [
        "delegates snapshot strategy to context protocol",
        /@noobot\/context-protocol\/policy\/snapshot/,
      ],
    ],
    forbidden: [["stopped snapshot legacy path fallback", /legacySnapshotPath\b/]],
  },
  {
    file: "agent/src/bot/session/model-message-runtime-helpers.js",
    required: [
      ["uses dual-lane context protocol", DUAL_LANE_IMPORT],
      ["declares primary context lane", PRIMARY_LANE],
      ["passes authoritative modelContext", /modelContext:\s*ctx\?\.modelContext/],
    ],
    forbidden: [
      [
        "payload messages become a flat context source",
        /ctx\?\.agentContext\?\.payload\?\.messages/,
      ],
    ],
  },
  {
    file: "agent/src/runtime/turn/turn-executor.js",
    required: [
      ["main turn uses dual-lane context protocol", DUAL_LANE_IMPORT],
      ["main turn declares primary lane", PRIMARY_LANE],
      [
        "before_llm hook passes authoritative modelContext",
        /const\s+modelContext\s*=\s*requireLoopStateModelContext\(loopState\)[\s\S]*?buildHookContext\(HOOK_POINT\.AGENT\.BEFORE_LLM_CALL[\s\S]*?modelContext,/,
      ],
      [
        "before_llm hook cannot replace authoritative entity",
        /assertHookContextRetainsModelContext\(loopState,\s*beforeLlmHookContext\)/,
      ],
    ],
  },
  {
    file: "agent/src/context/index.js",
    required: [
      [
        "shared session context resolves session history and long memory",
        /async\s+_buildSessionContext[\s\S]*?_resolveSessionRecords[\s\S]*?resolveLongMemory/,
      ],
      [
        "new-session context delegates to the shared session context builder",
        /async\s+buildNewSessionContext[\s\S]*?_buildSessionContext\([\s\S]*?"new_session"/,
      ],
      [
        "existing-session context delegates to the shared session context builder",
        /async\s+buildExistingSessionContext[\s\S]*?_buildSessionContext\([\s\S]*?"existing_session"/,
      ],
      [
        "context passes current turnScopeId to session history",
        /currentTurnScopeId:\s*text\(this\.runConfig\?\.turnScopeId\)/,
      ],
    ],
  },
  {
    file: "agent/src/context/assembly/message-builder.js",
    forbidden: [
      [
        "history filtering by current user text",
        /\bsameCurrentText\b|String\(\s*msg\?\.content\s*\|\|\s*["']["']\s*\)\.trim\(\)\s*===\s*normalizedCurrentUserMessage|\btext\(\s*msg\?\.content\s*\)\s*===\s*normalizedCurrentUserMessage/,
      ],
    ],
  },
  {
    file: "plugin/noobot-plugin-harness/src/core/model-message-context.js",
    required: [
      ["harness before_llm_call delegates to resolver", /applyAgentResolvedModelMessages/],
      ["uses injected resolveModelMessages", /resolveModelMessages/],
      [
        "updates only the final model-message projection",
        /replaceMessageProjection\(ctx,\s*resolved\)/,
      ],
    ],
  },
  {
    file: "agent/src/runtime/hooks/hook-context-builder.js",
    required: [
      [
        "hook context accepts only supplied versioned modelContext",
        /attachModelContext\(context,\s*modelContext\?\.protocolVersion\s*\?\s*modelContext\s*:\s*null\)/,
      ],
    ],
  },
  {
    file: "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/model/message-factory.js",
    required: [
      ["uses dual-lane context protocol", DUAL_LANE_IMPORT],
      ["declares auxiliary context lane", AUXILIARY_LANE],
    ],
  },
  {
    file: "plugin/noobot-plugin-workflow/src/core/orchestrator/semantic-resolution.js",
    required: [
      ["uses dual-lane context protocol", DUAL_LANE_IMPORT],
      ["declares auxiliary context lane", AUXILIARY_LANE],
      ["capability runner receives no second prompt source", /prompt:\s*["']["']/],
    ],
  },
  {
    file: "agent/src/runtime/loop-control.js",
    required: [
      ["help tool loop protocol marker", /CONTEXT_INJECTED_MESSAGE_TYPE\.HELP_TOOL_LOOP_PROMPT/],
      [
        "help tool loop uses canonical control-message appender",
        /appendTurnContextControlMessage\(\{[\s\S]{0,500}CONTEXT_INJECTED_MESSAGE_TYPE\.HELP_TOOL_LOOP_PROMPT/,
      ],
    ],
    scoped: [
      {
        scope: { around: HELP_LOOP_MARKER, before: 1000, after: 200 },
        forbidden: [
          [
            "help tool loop prompt enters the system block",
            /new\s+SystemMessage|block:\s*["']system["']/,
          ],
        ],
      },
    ],
  },
  {
    file: "agent/src/runtime/turn/turn-context-message-appender.js",
    required: [
      ["control messages persist as user", /role:\s*["']user["']/],
      ["control messages persist as context_control", /type:\s*["']context_control["']/],
      ["control messages project as HumanMessage", /new\s+HumanMessage\s*\(/],
      ["control messages enter incremental block", /block:\s*["']incremental["']/],
    ],
  },
]);
