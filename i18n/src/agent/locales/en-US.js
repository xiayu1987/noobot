/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TOOL_SCHEMA_FLAT_GENERATED, TOOL_SCHEMA_BY_TOOL } from "./en-US/tool-schema.js";
import { BACKEND_COMMON_EN_US } from "../../shared/locales/backend-common-en-US.js";

export { TOOL_SCHEMA_BY_TOOL };

export default {
  ...TOOL_SCHEMA_FLAT_GENERATED,
  ...BACKEND_COMMON_EN_US,
  "agent.legacyPluginRelayPrefix": "[Relay from harness external model/{purpose}]",
  "tools.script.commandTooLong":
    "Script content is too long. Please execute in batches or split the script/text and try again.",
  "tools.file.writeContentTooLong": "File content is too long. Please write in batches.",
  "tools.file.readContentTooLong": "File content is too long. Please read in batches.",
  "tools.input.tooLong": "Tool input is too long and was saved as an attachment.",
  "tools.search.textTooLong": "Search text is too long. Please search in smaller chunks.",
  "tools.patch.patchContentTooLong":
    "Patch content is too long. Please apply in batches or split the patch and try again.",
  "tools.result.toolResultOverflow": (params = {}) =>
    `Tool result is too long (${Number(params.measuredLength || 0)} chars) and was saved as an attachment. Read it in batches using the returned transfer info.`,
  "tools.result.readFileSourceReferenceOverflow":
    "read_file result is too long. The source file reference was kept; continue reading by source address and line range.",
  "tools.file.readDescriptionWithLineNumbers":
    "Read text file content (line numbers enabled by default).",
  "tools.file.workspaceRelativePathRule":
    "Relative paths are consistently resolved from the current user's workspace root.",
  "tools.file.symbolicLinkRule":
    "The current path policy does not allow file tools to use symbolic links.",
  "tools.file.readStartLineField": "Start line (1-based).",
  "tools.file.readEndLineField": "End line (1-based).",
  "tools.file.readIncludeLineNumbersField": "Whether content includes line numbers.",
  "tools.file.readMaxLinesField": "Maximum returned lines.",
  "tools.file.readLineRangeOutOfBounds": (params = {}) =>
    `Invalid read line range: requested ${Number(params.startLine || 0)}-${Number(params.endLine || 0)}, file has ${Number(params.totalLines || 0)} lines`,
  "tools.file.pathErrorRequired": (params = {}) =>
    `${String(params.field || "filePath")} is required.`,
  "tools.file.pathErrorHostAbsoluteNotAllowed":
    "The current principal cannot access host absolute paths.",
  "tools.file.pathErrorSandboxNotAllowed":
    "The current execution view does not accept sandbox absolute paths.",
  "tools.file.pathErrorSandboxNotMapped": "The sandbox path is not mapped to a shared file root.",
  "tools.file.pathErrorVirtualRelativeAmbiguous": (params = {}) => {
    const relative = String(params.suggestedPath || "");
    const sandbox = String(params.suggestedSandboxPath || "");
    return sandbox
      ? `The path is ambiguous. Use ${relative} as a workspace-relative path or ${sandbox} as a sandbox absolute path.`
      : `The path is ambiguous. Use ${relative} as a workspace-relative path.`;
  },
  "tools.file.pathErrorWorkspaceOutOfScope":
    "The workspace-relative path resolves outside the workspace root.",
  "tools.file.writeAlreadyExists": "The file already exists; set overwrite to true to replace it.",
  "tools.file.readRiskLevelField":
    "Operation risk level: low, medium, high, or critical. Reads that may involve privacy information, passwords, tokens, credentials, or secrets must be marked critical.",
  "tools.file.writeOverwriteField": "Whether to overwrite when file exists.",
  "tools.file.writeRiskLevelField":
    "Operation risk level: low, medium, high, or critical. Classify impact and destructiveness using the same standard as script execution.",
  "tools.risk.criticalConfirmation": (params = {}) =>
    [
      "A tool operation covered by the safety threshold requires your explicit confirmation.",
      `Tool: ${String(params.toolName || "")}`,
      `Operation: ${String(params.operation || "")}`,
      `Risk level: ${String(params.riskLevel || "")}`,
      params.target ? `Target: ${String(params.target)}` : "",
      params.reason ? `Risk: ${String(params.reason)}` : "",
      "Do you confirm proceeding?",
    ]
      .filter(Boolean)
      .join("\n"),
  "tools.risk.criticalConfirmationUnavailable":
    "This risk level requires confirmation, but the user interaction channel is unavailable.",
  "tools.risk.criticalCancelled": "The risky operation was not confirmed and was cancelled.",
  "scenarios.full.name": "All-around",
  "scenarios.full.description":
    "General scenario: no restrictions on tools and context; autonomously selects capabilities as needed.",
  "scenarios.programming.name": "Programming",
  "scenarios.programming.description":
    "Programming scenario: use search/read_file to confirm real content before patch_file; prefer exact-context patches and avoid hand-computing unified diff counts; after patch failure, reread then retry; use write_file only when needed.",
  "scenarios.text.name": "Text",
  "scenarios.text.description":
    "Text scenario: suited for writing, rewriting, summarizing, translating, and content organization.",
  "capability.finalPlanningPrompt":
    "Based on the above tool results, provide the final planning answer now.",
  "context.phaseSummaryTitle": "[Phase summary]",
  "transfer.pluginDetailAttachments": "Detail attachments:",
  "transfer.pluginValidationInfo": "Validation info:",
  "modelRuntime.httpStatus.400": "Invalid request parameters or format",
  "modelRuntime.httpStatus.401": "Authentication failed; check your API key",
  "modelRuntime.httpStatus.403": "You do not have permission to access this resource",
  "modelRuntime.httpStatus.404": "The requested resource was not found",
  "modelRuntime.httpStatus.429": "Too many requests or account quota exhausted",
  "modelRuntime.httpStatus.500": "Server error while processing the request; try again later",
  "modelRuntime.httpStatus.503": "The service is currently overloaded; try again later",
  "modelRuntime.imagesTaskIdMissing": "Task ID is missing",
  "modelRuntime.imagesTaskFailed": "Task failed",
  "modelRuntime.imagesTaskTimeout": ({ id } = {}) => `Task timed out: ${id}`,
};
