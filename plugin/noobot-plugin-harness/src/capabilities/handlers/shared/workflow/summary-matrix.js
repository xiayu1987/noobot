/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_SCENARIO,
  resolveHarnessScenarioFromOptions,
} from "./matrix-resolver.js";
import { resolveSummaryPatchProtocolSelection } from "./protocols.js";

export const GUIDANCE_SUMMARY_SCENARIO = HARNESS_SCENARIO;

export const GUIDANCE_SUMMARY_INSTRUCTION_MATRIX = Object.freeze({
  [HARNESS_SCENARIO.GENERAL]: Object.freeze({
    promptId: "guidance_summary_instruction/general",
    sampleProfile: "overview:plan,status,evidence,file,line; next:next_action",
    parts: Object.freeze(["summary_text_v2_blocks", "cumulative_summary_rules", "execution_next_action", "execution_policy"]),
  }),
  [HARNESS_SCENARIO.TEXT]: Object.freeze({
    promptId: "guidance_summary_instruction/text",
    sampleProfile: "overview:plan,status,evidence,file,line,path,text; next:text_next_action",
    parts: Object.freeze(["summary_text_v2_blocks", "external_text_consumption", "text_path_and_content", "text_next_action", "text_output_policy"]),
  }),
  [HARNESS_SCENARIO.PROGRAMMING]: Object.freeze({
    promptId: "guidance_summary_instruction/programming",
    sampleProfile: "overview:plan,status,evidence,file,method,line; next:programming_next_action",
    parts: Object.freeze(["summary_text_v2_blocks", "programming_code_location", "programming_next_action", "programming_execution_policy"]),
  }),
});

export function resolveGuidanceSummaryInstructionSelection(promptOptions = {}) {
  const scenario = resolveHarnessScenarioFromOptions(promptOptions);
  const selection = GUIDANCE_SUMMARY_INSTRUCTION_MATRIX[scenario] ||
    GUIDANCE_SUMMARY_INSTRUCTION_MATRIX[HARNESS_SCENARIO.GENERAL];
  return Object.freeze({
    scenario,
    promptId: selection?.promptId || `guidance_summary_instruction/${scenario}`,
    sampleProfile: selection?.sampleProfile || "",
    parts: Object.freeze([...(selection?.parts || [])]),
  });
}

export function resolveGuidanceSummaryPromptProtocolSelection(options = {}) {
  const instruction = resolveGuidanceSummaryInstructionSelection(options);
  const protocol = resolveSummaryPatchProtocolSelection(options);
  return Object.freeze({
    scenario: instruction.scenario,
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
