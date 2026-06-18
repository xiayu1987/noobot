/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_SCENARIO,
  HARNESS_WORKFLOW_MODE,
  resolveHarnessScenarioFromOptions,
  resolveHarnessWorkflowModeFromOptions,
} from "./matrix-resolver.js";
import { resolveSummaryPatchProtocolSelection } from "./protocols.js";

export const GUIDANCE_SUMMARY_SCENARIO = HARNESS_SCENARIO;
export const GUIDANCE_SUMMARY_WORKFLOW_MODE = HARNESS_WORKFLOW_MODE;

export const GUIDANCE_SUMMARY_INSTRUCTION_MATRIX = Object.freeze({
  [HARNESS_SCENARIO.GENERAL]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.BASE]: Object.freeze({
      promptId: "guidance_summary_instruction/general/base",
      sampleProfile: "overview:plan,status,evidence,file,line; next:plain_suggestion",
      parts: Object.freeze(["summary_text_v2_blocks", "cumulative_summary_rules", "plain_next_suggestion"]),
    }),
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: Object.freeze({
      promptId: "guidance_summary_instruction/general/execution_first",
      sampleProfile: "overview:plan,status,evidence,file,line; next:execution_first_next_action",
      parts: Object.freeze(["summary_text_v2_blocks", "cumulative_summary_rules", "execution_first_next_action", "execution_first_policy"]),
    }),
    [HARNESS_WORKFLOW_MODE.RISK_FIRST]: Object.freeze({
      promptId: "guidance_summary_instruction/general/risk_first",
      sampleProfile: "overview:plan,status,evidence,file,line; next:risk_first_next_action",
      parts: Object.freeze(["summary_text_v2_blocks", "cumulative_summary_rules", "risk_first_next_action", "risk_first_policy"]),
    }),
  }),
  [HARNESS_SCENARIO.TEXT]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.BASE]: Object.freeze({
      promptId: "guidance_summary_instruction/text/base",
      sampleProfile: "overview:plan,status,evidence,file,line,path,text; next:plain_suggestion",
      parts: Object.freeze(["summary_text_v2_blocks", "external_text_consumption", "text_path_and_content", "plain_next_suggestion"]),
    }),
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: Object.freeze({
      promptId: "guidance_summary_instruction/text/execution_first",
      sampleProfile: "overview:plan,status,evidence,file,line,path,text; next:text_output_next_action",
      parts: Object.freeze(["summary_text_v2_blocks", "external_text_consumption", "text_path_and_content", "text_output_next_action", "text_output_first_policy"]),
    }),
    [HARNESS_WORKFLOW_MODE.RISK_FIRST]: Object.freeze({
      promptId: "guidance_summary_instruction/text/risk_first",
      sampleProfile: "overview:plan,status,evidence,file,line,path,text; next:risk_first_next_action",
      parts: Object.freeze(["summary_text_v2_blocks", "external_text_consumption", "text_path_and_content", "risk_first_next_action", "risk_first_policy"]),
    }),
  }),
  [HARNESS_SCENARIO.PROGRAMMING]: Object.freeze({
    [HARNESS_WORKFLOW_MODE.EXECUTION_FIRST]: Object.freeze({
      promptId: "guidance_summary_instruction/programming/execution_first",
      sampleProfile: "overview:plan,status,evidence,file,method,line; next:programming_next_action",
      parts: Object.freeze(["summary_text_v2_blocks", "programming_code_location", "programming_next_action", "programming_execution_policy"]),
    }),
  }),
});

export function resolveGuidanceSummaryInstructionSelection(promptOptions = {}) {
  const scenario = resolveHarnessScenarioFromOptions(promptOptions);
  const workflowMode = resolveHarnessWorkflowModeFromOptions(promptOptions, { scenario });
  const scenarioMatrix = GUIDANCE_SUMMARY_INSTRUCTION_MATRIX[scenario] ||
    GUIDANCE_SUMMARY_INSTRUCTION_MATRIX[HARNESS_SCENARIO.GENERAL];
  const selection = scenarioMatrix?.[workflowMode] ||
    scenarioMatrix?.[HARNESS_WORKFLOW_MODE.BASE] ||
    scenarioMatrix?.[HARNESS_WORKFLOW_MODE.EXECUTION_FIRST];
  return Object.freeze({
    scenario,
    workflowMode,
    promptId: selection?.promptId || `guidance_summary_instruction/${scenario}/${workflowMode}`,
    sampleProfile: selection?.sampleProfile || "",
    parts: Object.freeze([...(selection?.parts || [])]),
  });
}

export function resolveGuidanceSummaryPromptProtocolSelection(options = {}) {
  const instruction = resolveGuidanceSummaryInstructionSelection(options);
  const protocol = resolveSummaryPatchProtocolSelection(options);
  return Object.freeze({
    scenario: instruction.scenario,
    workflowMode: instruction.workflowMode,
    instructionPromptId: instruction.promptId,
    instructionParts: instruction.parts,
    instructionSampleProfile: instruction.sampleProfile,
    protocolFamily: protocol.protocolFamily,
    protocolId: protocol.protocolId,
    protocolFields: protocol.overviewFields,
    nextActionProtocolId: protocol.nextActionProtocolId,
  });
}

export function buildGuidanceSummarySelectionProfileText(options = {}) {
  const selection = resolveGuidanceSummaryPromptProtocolSelection(options);
  return [
    "[HARNESS_SUMMARY_SELECTION]",
    `scenario = ${selection.scenario}`,
    `workflow_mode = ${selection.workflowMode}`,
    `instruction_prompt = ${selection.instructionPromptId}`,
    `instruction_parts = ${[...selection.instructionParts].join(",")}`,
    `instruction_sample_profile = ${selection.instructionSampleProfile}`,
    `text_protocol = ${selection.protocolFamily}`,
    `patch_protocol = ${selection.protocolId}`,
    `protocol_fields = ${[...selection.protocolFields].join(",")}`,
    `next_action_protocol = ${selection.nextActionProtocolId}`,
    "[/HARNESS_SUMMARY_SELECTION]",
  ].join("\n");
}
