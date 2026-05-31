/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

// Unified parameter center for workflow orchestration knobs.
// Keep shape stable by domain -> concern -> knobs.
export const WORKFLOW_PARAMS = deepFreeze({
  workflow: {
    events: {
      priorityDecision: "workflow_priority_decision",
      executionResult: "workflow_execution_result",
      reasoningRetryScheduled: "capability_reasoning_retry_scheduled",
    },
  },
  logging: {
    events: {
      planning: {
        promptInjected: "planning_prompt_injected",
        rawOutputRecorded: "planning_raw_output_recorded",
        checklistCaptured: "planning_checklist_captured",
        checklistRetryScheduled: "planning_checklist_retry_scheduled",
        checklistRetryScheduledBySeparateModel: "planning_checklist_retry_scheduled_by_separate_model",
        checklistCapturedBySeparateModel: "planning_checklist_captured_by_separate_model",
        separateModelSkippedInflight: "planning_separate_model_skipped_inflight",
        separateModelCallFailed: "planning_separate_model_call_failed",
        captureSkippedForToolCallTurn: "planning_capture_skipped_for_tool_call_turn",
        captureBlockedForToolCallTurn: "planning_capture_blocked_for_tool_call_turn",
        defaultChecklistApplied: "planning_default_checklist_applied",
        revisionScheduledByTurnThreshold: "planning_revision_scheduled_by_turn_threshold",
        refinementToolInjected: "planning_refinement_tool_injected",
        refinementInvokerMissing: "planning_refinement_invoker_missing",
        refinementConvergedNoTargetMainStep: "planning_refinement_converged_no_target_main_step",
        refinementModelFailed: "planning_refinement_model_failed",
      },
      guidance: {
        summaryPromptInjected: "summary_prompt_injected",
        guidancePromptInjected: "guidance_prompt_injected",
        summaryMessagesMarked: "summary_messages_marked",
        summaryCompletionMarkerMissing: "summary_completion_marker_missing",
        revisionModelFailed: "planning_revision_model_failed",
        revisionNotApplied: "planning_revision_not_applied",
        revisionSkippedByMaxAttempts: "planning_revision_skipped_by_max_attempts",
        refinementConvergedNoTargetMainStep: "planning_refinement_converged_no_target_main_step",
        refinementSkippedByMaxAttempts: "planning_refinement_skipped_by_max_attempts",
        planUpdatePromptInjected: "planning_plan_update_prompt_injected",
        separateModelCallFailed: "guidance_separate_model_call_failed",
        summaryGeneratedBySeparateModel: "summary_generated_by_separate_model",
        guidanceGeneratedBySeparateModel: "guidance_generated_by_separate_model",
        revisionScheduledByInject: "planning_revision_scheduled_by_inject",
        refinementScheduledByInject: "planning_refinement_scheduled_by_inject",
        planUpdateCaptureCompletedInject: "planning_plan_update_capture_completed_inject",
        planUpdateCaptureFailedInject: "planning_plan_update_capture_failed_inject",
      },
      acceptance: {
        phaseAcceptanceScheduledByTurnThreshold: "phase_acceptance_scheduled_by_turn_threshold",
        phaseAcceptancePromptInjected: "phase_acceptance_prompt_injected",
        phaseAcceptanceCompletedInject: "phase_acceptance_completed_inject",
        phaseAcceptanceCaptureFailedInject: "phase_acceptance_capture_failed_inject",
        phaseAcceptanceFailed: "phase_acceptance_failed",
        phaseAcceptanceCompleted: "phase_acceptance_completed",
        phaseAcceptanceGeneratedBeforeFinalOutputFallback:
          "phase_acceptance_generated_before_final_output_fallback",
        phaseAcceptanceBeforeFinalFailed: "phase_acceptance_before_final_failed",
        phaseAcceptanceGeneratedBeforeFinalOutput: "phase_acceptance_generated_before_final_output",
        semanticValidationPromptInjected: "acceptance_semantic_validation_prompt_injected",
        semanticValidationScheduledByInject: "acceptance_semantic_validation_scheduled_by_inject",
        semanticValidationCompletedInject: "acceptance_semantic_validation_completed_inject",
        semanticValidationCaptureFailedInject: "acceptance_semantic_validation_capture_failed_inject",
        semanticValidationFailed: "acceptance_semantic_validation_failed",
        semanticValidationEmptyOutput: "acceptance_semantic_validation_empty_output",
        semanticValidationCompleted: "acceptance_semantic_validation_completed",
        checklistArtifactAttachFailed: "checklist_artifact_attach_failed",
        checklistArtifactsAttached: "checklist_artifacts_attached",
        forcedAcceptanceTriggered: "forced_acceptance_triggered",
        taskAcceptanceToolInjected: "task_acceptance_tool_injected",
      },
      review: {
        reportGenerated: "review_report_generated",
      },
      shared: {
        workflowInvariantViolation: "workflow_invariant_violation",
        capabilityReasoningCaptured: "capability_reasoning_captured",
        capabilityReasoningRetryExhaustedError: "capability_reasoning_retry_exhausted_error",
        capabilityOutputAttachmentSaveFailed: "capability_output_attachment_save_failed",
        separateModelRelaySkippedDuplicate: "planning_separate_model_relay_skipped_duplicate",
        separateModelRelaySkippedTurnEnded: "planning_separate_model_relay_skipped_turn_ended",
        separateModelRelayInjectedAsSystemContext: "planning_separate_model_relay_injected_as_system_context",
        capabilityModelTrace: "capability_model_trace",
      },
    },
  },
  contextWindow: {
    // Harness-side model context clipping window size (recent messages).
    // This replaces agent session.recentMessageLimit for harness flow.
    recentMessageLimit: 20,
    // Incremental block clipping window size (recent messages).
    incrementalRecentMessageLimit: 20,
  },
  planning: {
    summary: {
      turnsThreshold: 6,
      messageCharsThreshold: 150000,
      overflowPolicy: {
        enablePruneAfterSummary: true,
        pruneTriggerAfterCharSummaryRounds: 1,
        forceAcceptanceWhenStillOverflow: true,
      },
    },
    planUpdate: {
      maxAttempts: 5,
      triggerTurnsThreshold: 3,
    },
    capture: {
      maxAttempts: 2,
      rawOutputLimit: 20,
      summaryMaxItems: 8,
      compactTextMaxChars: 500,
      rawOutputPreviewMaxChars: 300,
      contextGoalMaxChars: 800,
    },
    tools: {
      summaryToolName: "task_summary",
      planRefinementToolName: "request_plan_refinement",
    },
    decisions: {
      action: {
        planningBootstrap: "planning_bootstrap",
        planningCapture: "planning_capture",
      },
      label: {
        summaryOverflow: "summary_overflow",
        summaryTurns: "summary_turns",
        planUpdateRevision: "plan_update_revision",
        phaseAcceptance: "phase_acceptance",
      },
      reason: {
        idle: "planning_idle",
        summaryThresholdTurns: "summary_threshold_turns",
        summaryThresholdChars: "summary_threshold_chars",
        planUpdateThreshold: "plan_update_threshold",
        phaseAcceptanceThreshold: "phase_acceptance_threshold",
        afterLlmCapture: "after_llm_capture",
      },
      requestedAction: {
        planningInject: "planning_inject",
        planningSeparateModel: "planning_separate_model",
        planningCapture: "planning_capture",
      },
    },
  },
  guidance: {
    failureThreshold: {
      consecutive: 3,
      accumulated: 10,
    },
    scheduler: {
      priorityOrder: ["summary_overflow", "guidance", "plan_update", "summary_turns"],
    },
    decisions: {
      action: {
        summary: "summary",
        guidance: "guidance",
        planUpdate: "plan_update",
        none: "none",
      },
      label: {
        summaryOverflow: "summary_overflow",
        summaryTurns: "summary_turns",
        planUpdateRevision: "plan_update_revision",
        planUpdateRefinement: "plan_update_refinement",
        guidance: "guidance",
        phaseAcceptance: "phase_acceptance",
        none: "none",
      },
      stage: {
        revision: "revision",
        refinement: "refinement",
      },
      reason: {
        pendingSummaryOverflow: "pending_summary_overflow",
        pendingSummaryTurns: "pending_summary_turns",
        pendingGuidance: "pending_guidance",
        pendingRevision: "pending_revision",
        pendingRefinement: "pending_refinement",
        idle: "idle",
      },
      requestedAction: {
        none: "none",
        summaryInject: "summary_inject",
        summarySeparateModel: "summary_separate_model",
        guidanceInject: "guidance_inject",
        guidanceSeparateModel: "guidance_separate_model",
        planUpdateRevisionInject: "plan_update_revision_inject",
        planUpdateRevisionSeparateModel: "plan_update_revision_separate_model",
        planUpdateRefinementInject: "plan_update_refinement_inject",
        planUpdateRefinementSeparateModel: "plan_update_refinement_separate_model",
      },
    },
    web: {
      serviceName: "web_search_service",
      toolNames: ["call_service"],
    },
  },
  acceptance: {
    semanticValidation: {
      enabled: true,
    },
    phase: {
      triggerTurnsThreshold: 9,
      blockerKeys: ["summary", "guidance", "planUpdate", "planningCaptured"],
    },
    tools: {
      taskAcceptanceToolName: "request_task_acceptance",
    },
    guards: {
      overflowForcedAcceptanceSystemPrompt:
        "Context overflow remains after summary/pruning. Call {tool} with mode=forced now.",
      blockedAgentToolNames: ["plan_multi_task_collaboration", "task_summary"],
    },
    decisions: {
      category: {
        workflow: "workflow",
        guard: "guard",
      },
      action: {
        phaseAcceptance: "phase_acceptance",
        forcedAcceptance: "forced_acceptance",
        acceptanceSemanticValidation: "acceptance_semantic_validation",
        acceptanceToolGuard: "acceptance_tool_guard",
        finalOutputAcceptanceGuard: "final_output_acceptance_guard",
        acceptanceCapture: "acceptance_capture",
        none: "none",
      },
      reason: {
        overflowForceAcceptance: "overflow_force_acceptance",
        phaseAcceptanceBlocked: "phase_acceptance_blocked",
        phaseAcceptancePending: "phase_acceptance_pending",
        acceptanceSemanticValidationPending: "acceptance_semantic_validation_pending",
        toolGuard: "tool_guard",
        beforeTurnSetup: "before_turn_setup",
        finalOutputOverflowFallback: "final_output_overflow_fallback",
        finalOutputAcceptanceFallback: "final_output_acceptance_fallback",
        afterLlmCapture: "after_llm_capture",
        idle: "idle",
      },
      requestedAction: {
        none: "none",
        phaseAcceptanceInject: "phase_acceptance_inject",
        phaseAcceptanceSeparateModel: "phase_acceptance_separate_model",
        acceptanceSemanticValidationInject: "acceptance_semantic_validation_inject",
        acceptanceToolGuardBeforeTurn: "acceptance_tool_guard_before_turn",
        acceptanceToolGuardBeforeToolCalls: "acceptance_tool_guard_before_tool_calls",
        acceptanceToolGuardBeforeToolCall: "acceptance_tool_guard_before_tool_call",
        forcedAcceptanceBeforeLlmInject: "forced_acceptance_before_llm_inject",
        forcedAcceptanceBeforeToolCallsRewrite: "forced_acceptance_before_tool_calls_rewrite",
        forcedAcceptanceBeforeToolCallRewrite: "forced_acceptance_before_tool_call_rewrite",
        finalOutputAcceptanceGuard: "final_output_acceptance_guard",
        finalOutputOverflowGuard: "final_output_overflow_guard",
        acceptanceCaptureInject: "acceptance_capture_inject",
      },
    },
  },
  review: {
    hooks: ["before_final_output", "on_error", "on_abort"],
    decisions: {
      action: {
        reviewReport: "review_report",
      },
      reason: {
        hookReview: "hook_review",
      },
      requestedAction: {
        reportAttachOutput: "review_report_attach_output",
        reportInternal: "review_report_internal",
      },
    },
  },
});
