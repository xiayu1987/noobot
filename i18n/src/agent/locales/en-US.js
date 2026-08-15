/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { TOOL_SCHEMA_FLAT_GENERATED, TOOL_SCHEMA_BY_TOOL } from "./en-US/tool-schema.js";

export { TOOL_SCHEMA_BY_TOOL };

export default {
  ...TOOL_SCHEMA_FLAT_GENERATED,
  "agent.fetchGeneratedMediaFailed": (params = {}) =>
    `fetch generated media failed: HTTP ${Number(params.status || 500)}`,
  "agent.fetchRemoteMediaArtifactFailed": (params = {}) =>
    `failed to fetch remote media artifact: ${String(params.url || "").trim()}${String(params.reason || "").trim() ? ` (${String(params.reason || "").trim()})` : ""}`,
  "agent.subTaskLabelPrefix": "Subtask",
  "agent.toolLoopLimitReached": (params = {}) =>
    `Tool call turns reached the limit (${Number(params.maxTurns || 0)}), auto-stopped.`,
  "agent.toolLoopLimitFinalizePrompt": (params = {}) =>
    `Tool-call turns reached the limit (${Number(params.maxTurns || 0)}). Stop calling tools and provide a final summary with actionable next steps.`,
  "agent.toolConsecutiveFailureLimitReached": (params = {}) =>
    `Tool "${String(params.toolName || "").trim() || "unknown"}" failed ${Number(params.maxFails || 5)} times consecutively. Loop stopped automatically.`,
  "agent.toolConsecutiveFailureHelpPrompt": (params = {}) =>
    `Tool calls have failed consecutively ${Number(params.failureCount || 0)} times. If needed, call ${String(params.helpToolName || "request_help")} with help content for assistance.`,
  "agent.helpToolLoopPrompt": (params = {}) =>
    `Tool loop has run ${Number(params.loopCount || 0)} turns. Consider calling ${String(params.helpToolName || "request_help")} for extra help.`,
  "agent.toolChoiceRequiredRetryPrompt":
    "Please use tools to execute tasks. If there is no task, the task is finished, or you need to end proactively, call the final_answer tool.",
  "agent.taskSummarySingleToolPrompt":
    "task_summary must be called alone and cannot appear in the same tool-call turn as other tools.",
  "agent.taskCheckSingleToolPrompt":
    "task_check must be called alone and cannot appear in the same tool-call turn as other tools.",
  "agent.legacyPluginRelayPrefix": "[Relay from harness external model/{purpose}]",
  "agent.userMetaTag": "User Metadata",
  "attach.countExceedsLimit": "attachments count exceeds limit",
  "attach.extensionNotAllowed": "attachment extension not allowed",
  "attach.fileTooLarge": "attachment too large",
  "attach.hintAddExtensionToAllowedExtensions":
    "extension is not allowed by built-in attachment policy",
  "attach.hintIncreaseMaxFileCountOrReduceFiles": "reduce uploaded files",
  "attach.hintIncreaseMaxFileSizeOrUploadSmaller": "upload a smaller file",
  "attach.hintIncreaseMaxTotalSizeOrReduceUpload": "reduce upload size",
  "attach.mimeTypeNotAllowed": "attachment mime type not allowed",
  "attach.sessionIdPersistenceHint": "pass rootSessionId or sessionId when saving attachments",
  "attach.sessionIdRequiredForPersistence": "sessionId required for attachment persistence",
  "attach.totalSizeExceedsLimit": "attachments total size exceeds limit",
  "auth.forbiddenUserScope": "forbidden user scope",
  "auth.missingApiKey": "missing or invalid apiKey",
  "auth.missingUserAuth": "missing user auth",
  "auth.superAdminRequired": "super admin required",
  "async.jobNotFound": "job not found",
  "bot.invalidCaller": "invalid caller",
  "bot.invalidParentSessionIdFormat": "invalid parentSessionId format",
  "bot.invalidSessionIdFormat": "invalid sessionId format (UUID required)",
  "bot.scenarioConfigContextObjectRequired": "scenario config 'context' must be an object",
  "bot.scenarioConfigObjectRequired": "scenario config must be a valid object",
  "bot.scenarioConfigToolsArrayRequired": "scenario config 'tools' must be an array",
  "bot.sharedTaskSpecPrefix": "Shared task spec",
  "common.attachmentNotFound": "attachment not found",
  "common.basePathRequired": "basePath required",
  "common.controlCharsNotAllowed": "must not contain control characters",
  "common.deleteSessionFailed": "delete session failed",
  "common.downloadWorkspaceFileFailed": "download workspace file failed",
  "common.fieldRequired": "required",
  "common.fileNameIncludedRequired": "must include file name",
  "common.fileNotFound": "file not found",
  "common.userIdRequired": "userId required",
  "common.atLeastOneUserRequired": "at least one user is required",
  "common.duplicateUserId": (params = {}) =>
    `duplicate userId: ${String(params.userId || "").trim()}`,
  "common.getConnectorsFailed": "get connectors failed",
  "common.inputOutputDirRequired": "input/outputDir required",
  "common.invalidUrl": "invalid url",
  "common.invalidUuidFormat": "invalid format (UUID required)",
  "common.loadConfigParamsCatalogFailed": "load config params catalog failed",
  "common.loadTemplateTreeFailed": "load template tree failed",
  "common.loadWorkspaceTreeFailed": "load workspace tree failed",
  "common.noProcessableUrl": "no processable URL found",
  "common.notFound": "not found",
  "common.notFoundInParentSessionMessages": "not found in parent session messages",
  "common.parentSessionNotFound": "parent session not found",
  "common.pathIsNotFile": "path is not a file",
  "common.pathOutOfScope": "path out of scope",
  "common.pathRequired": "path required",
  "common.pathSeparatorsNotAllowed": "must not contain path separators",
  "common.readConfigParamsFailed": "read config params failed",
  "common.readTemplateFileFailed": "read template file failed",
  "common.readUsersFailed": "read users failed",
  "common.readWorkspaceFileFailed": "read workspace file failed",
  "common.resetAllWorkspaceFailed": "reset all workspace failed",
  "common.resetWorkspaceFailed": "reset workspace failed",
  "common.runtimeBasePathMissing": "runtime basePath missing",
  "common.saveConfigParamsFailed": "save config params failed",
  "common.saveSelectedConnectorsFailed": "save selected connectors failed",
  "common.saveTemplateFileFailed": "save template file failed",
  "common.saveUsersFailed": "save users failed",
  "common.saveWorkspaceFileFailed": "save workspace file failed",
  "common.sessionContextMissing": "session context missing",
  "common.sessionIdRequired": "sessionId required",
  "common.sessionIdRequiredForCrypto": "sessionId required for session crypto",
  "common.superAdminRequiredForSystemParams": "super admin required for system params",
  "common.syncAllWorkspaceFailed": "sync all workspace failed",
  "common.syncWorkspaceFailed": "sync workspace failed",
  "common.tooManyRedirects": "too many redirects",
  "common.unrecognizedInput": "unrecognized input",
  "common.unrecognizedInputUrlFileDir": "unrecognized input (not URL/file/directory)",
  "common.userParentSessionRequired": "userId/parentSessionId required",
  "common.userParentSessionSessionRequired": "userId/parentSessionId/sessionId required",
  "common.userSessionMessageRequired": "userId/sessionId/message required",
  "common.userSessionRequired": "userId/sessionId required",
  "common.workspaceRootUserIdRequired": "workspaceRoot/userId required",
  "connect.codeVerifyFailed": "connect code verification failed",
  "connect.failed": "connect failed",
  "connect.userIdConnectCodeRequired": "userId/connectCode required",
  "context.contextBuilderRequired": "contextBuilder is required",
  "context.builderContainerInputRequired":
    "ContextBuilder requires container input: { config, serviceContainer, sessionContext }",
  "init.invalidResetSections": "invalid reset sections",
  "init.userWorkspacePathNotDirectory": "user workspace path is not a directory",
  "init.workspaceTemplateMissing": "workspace template missing",
  "init.workspaceTemplatePathRequired": "workspaceTemplatePath required",
  "model.apiKeyMissingForProviderAlias": "missing api key for provider alias",
  "model.nameRequired": "model name is required",
  "model.notConversationModel": (params = {}) =>
    `model is not available for conversation switch: ${String(params.alias || "").trim()}`,
  "tools.script.commandTooLong":
    "Script content is too long. Please execute in batches or split the script/text and try again.",
  "tools.file.writeContentTooLong": "File content is too long. Please write in batches.",
  "tools.file.readContentTooLong": "File content is too long. Please read in batches.",
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
  "tools.file.readRiskLevelField":
    "Operation risk level: low, medium, high, or critical. Reads that may involve privacy information, passwords, tokens, credentials, or secrets must be marked critical.",
  "tools.file.writeOverwriteField": "Whether to overwrite when file exists.",
  "tools.file.writeRiskLevelField":
    "Operation risk level: low, medium, high, or critical. Classify impact and destructiveness using the same standard as script execution.",
  "tools.search.description": "Search files or text, returning matched lines with context.",
  "tools.search.fieldSource": "Search source: files or text.",
  "tools.search.fieldQuery":
    "Required non-empty keyword or regex. Do not call search with an empty string.",
  "tools.search.fieldIsRegex": "Search query as regex.",
  "tools.search.fieldCaseSensitive": "Case-sensitive search.",
  "tools.search.fieldPath": "Path for file search.",
  "tools.search.fieldGlob": "File pattern, e.g. *.js.",
  "tools.search.fieldText": "Text to search (used when source=text).",
  "tools.search.fieldContextLines": "Number of context lines.",
  "tools.search.fieldMaxResults": "Maximum matches.",
  "tools.search.fieldRiskLevel":
    "Operation risk level: low, medium, high, or critical. Searches that may retrieve or return privacy information, passwords, tokens, credentials, or secrets must be marked critical.",
  "tools.patch_file.description":
    "Apply git/unified diff or apply_patch content with deterministic path resolution.",
  "tools.patch_file.fieldFormat":
    "Patch format; omit it to detect the format from the content. An explicit mismatch is rejected.",
  "tools.patch_file.fieldPatch":
    "Patch content; read the file first and use exact context. Follow the current path rules in system context. Do not write virtual root names as relative path prefixes.",
  "tools.patch_file.fieldPatchPathHintHost":
    "Workspace logical view: prefer paths relative to the current user's workspace. Regular users cannot access paths that remain in the host view after normalization; absolute inputs inside their own workspace normalize to the workspace view.",
  "tools.patch_file.fieldPatchPathHintSuperHost":
    "Workspace logical view: relative paths use the current user's workspace; super administrators may also use host absolute paths authorized by the global path policy.",
  "tools.patch_file.fieldStrip":
    "Exact number of leading relative diff path components to remove (usually 1 for a/ and b/). No path guessing is performed; parent traversal remaining after stripping is rejected.",
  "tools.patch_file.fieldRoot":
    "Patch root directory (optional, workspace-relative child directory only). Usually omit it. Do not use parent-directory traversal.",
  "tools.patch_file.fieldRootPathHintSandbox":
    "root is not an entry point for sandbox absolute paths.",
  "tools.patch_file.fieldRootPathHintHost": "root only selects a workspace child directory.",
  "tools.patch_file.fieldRootPathHintSuperHost":
    "root is not an entry point for host absolute paths.",
  "tools.patch_file.rootInvalidHintHost":
    "Do not use root:'..' or absolute paths as root; root only selects a workspace-relative child directory.",
  "tools.patch_file.rootInvalidHintSuperHost":
    "Do not use root:'..' or host absolute paths as root; root only selects a workspace-relative child directory. Put host absolute paths directly in patch file paths.",
  "tools.patch_file.fieldDryRun": "Validate only, do not write.",
  "tools.patch_file.fieldRiskLevel":
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
  "services.handlerModuleNotFound": "service handler module not found",
  "services.handlerNotFound": "service handler not found",
  "services.handlerRequired": "service handler required",
  "session.parentSessionNotFoundPossiblyDeleted": "parent session not found (possibly deleted)",
  "session.workspaceNotInitialized": "workspace not initialized",
  "status.disconnectedFromHistory": "disconnected from history",
  "web2img.readabilityNotInstalledWarn":
    "@mozilla/readability/jsdom not installed; fallback to DOM extraction. Run: npm i @mozilla/readability jsdom",
  "web2img.contentTruncated": "content too long, truncated",
  "web2img.descriptionLabel": "Description",
  "web2img.mainContentTitle": "Main Content",
  "web2img.noContentExtracted": "no content extracted",
  "web2img.textCleanAppendixTitle": "Text Cleaning Appendix",
  "web2img.noReadableTextExtracted": "no trafilatura/readability text extracted",
  "web2img.resultIndex": "Result index",
  "web2img.sharpNotInstalledRawWarn":
    "sharp not installed, cannot post-process images; raw screenshot will be returned. Run: npm i sharp",
  "web2img.sharpNotInstalledSplitWarn":
    "sharp not installed; image post-processing/splitting unavailable. Run: npm i sharp",
  "ws.badRequest": "Bad Request",
  "ws.dialogStoppedByUser": "dialog stopped by user",
  "ws.interactionEncryptedRequired": "encrypted interaction response required",
  "ws.interactionNotFound": "interaction request not found",
  "ws.sessionAlreadyRunning": "session already running on this websocket",
  "ws.socketClosed": "websocket closed",
  "ws.unauthorized": "Unauthorized",
  "ws.unknownError": "unknown error",
  "ws.userInteractionTimeout": "user interaction timeout",
  "agent.phaseSummaryPrompt":
    "The context has reached the phase-summary threshold. This turn must call only task_summary. summaryContent must strictly use the single text protocol: NOOBOT_TASK_SUMMARY/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort factual summary of the completed phase\n[DETAILS]\nAuthoritative phase state integrated with prior summaries, clearly distinguishing completed work, key results, remaining work, and blockers; in programming mode include file paths, function names, and line numbers\n[NEXT_ACTION]\nThe single specific unfinished action to execute next. Every section must be non-empty; do not add, repeat, or reorder sections. Use CONTINUE while executable work remains; subsequent work must resume only from NEXT_ACTION without repeating completed work. Use COMPLETE when the task is finished and BLOCKED only when progress is impossible.",
  "agent.taskCheckPrompt":
    "The periodic task-check threshold has been reached. For this model call, you may call task_check to leave a task-check slice, but the call is optional; this prompt appears only for this call. If called, checkContent must strictly use the single text protocol: NOOBOT_TASK_CHECK/1\n[STATE]\nCONTINUE|COMPLETE|BLOCKED\n[ABSTRACT]\nShort task-check abstract\n[DETAILS]\nCurrent goal, progress, drift risks, and omissions\n[NEXT_ACTION]\nSpecific next action. Every section must be non-empty; do not add, repeat, or reorder sections.",
  "agent.abortError": "dialog stopped by user",
  "scenarios.full.name": "All-around",
  "scenarios.full.description":
    "General scenario: no restrictions on tools and context; autonomously selects capabilities as needed.",
  "scenarios.programming.name": "Programming",
  "scenarios.programming.description":
    "Programming scenario: use search/read_file to confirm real content before patch_file; prefer exact-context patches and avoid hand-computing unified diff counts; after patch failure, reread then retry; use write_file only when needed.",
  "scenarios.text.name": "Text",
  "scenarios.text.description":
    "Text scenario: suited for writing, rewriting, summarizing, translating, and content organization.",
};
