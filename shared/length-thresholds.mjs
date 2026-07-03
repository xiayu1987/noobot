/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Central length-related thresholds.
 *
 * Keep turn counts, item counts, timeouts, pixel limits, and retry limits out of
 * this file. This module is only for character/byte/string-size thresholds that
 * decide when content is clipped, summarized, transferred, or persisted.
 *
 * Value tiers:
 * Display/diagnostic char tiers:
 * - 20-300 chars: extension names, terse log/progress labels, and raw-output previews.
 * - 1000-1200 chars: short trace, MCP result, and Harness record previews.
 *
 * Context/transfer char tiers:
 * - 500-800 chars: compact planning/payload fields.
 * - 1200 chars: semantic-transfer file-backed result preview.
 * - 2000 chars: structured workflow previews.
 * - 4000 chars: larger dynamic prompt snippets.
 * - 30000 chars: persisted text chunk and semantic-transfer inline/fileization boundary.
 * - 120000/200000/225000/300000 chars: cleaner, wrapped payload, main-context, and external/tool-heavy tiers.
 *
 * Artifact text char tiers:
 * - 300000/500000 chars: generated web2img useful/full page text artifacts.
 *
 * Byte tiers:
 * - 256 KiB: generated command artifacts.
 * - ~0.8 MiB: batched extraction payloads.
 * - 2 MiB: per-file search/read guard.
 * - 5 MiB: JSONL buffer guard.
 * - 8-10 MiB: direct text read and single attachment tiers.
 * - 16-30 MiB: process buffer and total attachment tiers.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

const KiB = 1024;
const MiB = 1024 * KiB;

const LENGTH_TIERS = deepFreeze({
  chars: {
    compact: 500,
    compactPayload: 800,
    persistedChunk: 40000,
    cleanedText: 120000,
    wrappedPayload: 200000,
    mainContext: 25000,
    externalToolHeavy: 350000,
  },
  displayChars: {
    extensionName: 20,
    modelContextContent: 120,
    executionLogBrief: 160,
    sessionSummaryFileName: 200,
    hookProgressText: 240,
    planningRawPreview: 300,
    shortTrace: 1000,
    harnessPreview: 1200,
    sessionSummaryArrayItem: 500,
    sessionSummarySmallJsonString: 500,
    sessionSummaryDefaultJsonString: 2000,
    sessionSummaryText: 4000,
    memoryParserCandidatePreview: 2000,
  },
  contextPreviewChars: {
    semanticTransferFileBacked: 1200,
    compactPlanning: 500,
    compactPayload: 800,
    structuredWorkflow: 2000,
    dynamicPolicyPrompt: 4000,
  },
  extractionChars: {
    minTagText: 6,
    htmlProbe: 20000,
  },
  artifactTextChars: {
    web2ImgUsefulText: 300000,
    web2ImgFullText: 500000,
  },
  bytes: {
    connectorCommandFile: 256 * KiB,
    batchPayload: Math.floor(0.8 * MiB),
    searchFile: 2 * MiB,
    jsonlBuffer: 5 * MiB,
    directText: 8 * MiB,
    attachmentFile: 10 * MiB,
    searchBuffer: 16 * MiB,
    attachmentTotal: 30 * MiB,
    libreOfficeTempBaseline: 512 * MiB,
  },
});

export const LENGTH_THRESHOLDS = deepFreeze({
  context: {
    // Main-context tier: unsummarized main-agent context chars that trigger phase summary.
    phaseSummaryMessageChars: LENGTH_TIERS.chars.mainContext,

    // External/tool-heavy tier: unsummarized Harness context chars that trigger summary/overflow handling.
    harnessSummaryMessageChars: LENGTH_TIERS.chars.externalToolHeavy,
  },

  semanticTransfer: {
    // Max chars kept as direct transfer content before materializing to file.
    directChars: LENGTH_TIERS.chars.persistedChunk,

    // Max tool-result chars returned inline before semantic-transfer overflow.
    toolResultInlineChars: LENGTH_TIERS.chars.persistedChunk,

    // Max tool-input chars accepted inline before saving the input as transfer artifact.
    toolInputOverflowChars: LENGTH_TIERS.chars.persistedChunk,

    // Small preview included beside file-backed transfer results.
    previewChars: LENGTH_TIERS.contextPreviewChars.semanticTransferFileBacked,
  },

  memory: {
    // Max serialized long-memory prompt payload before trimming.
    longPromptPayloadChars: LENGTH_TIERS.chars.mainContext,

    // Persisted chunk tier shared with semantic-transfer inline/fileization boundaries.
    fileSplitChars: LENGTH_TIERS.chars.persistedChunk,
  },

  attachments: {
    // Max bytes accepted for one uploaded attachment.
    maxFileSizeBytes: LENGTH_TIERS.bytes.attachmentFile,

    // Max total bytes accepted across uploaded attachments.
    maxTotalSizeBytes: LENGTH_TIERS.bytes.attachmentTotal,
  },

  toolIO: {
    // Precheck bytes for text input that maps to semantic-transfer tool input.
    fileContentBytesPrecheckMultiplier: 2,

    // Max file bytes searched per file by workspace search.
    searchFileBytes: LENGTH_TIERS.bytes.searchFile,

    // Max process buffer for workspace search output.
    searchBufferBytes: LENGTH_TIERS.bytes.searchBuffer,

    // ripgrep filesize guard for workspace search.
    ripgrepMaxFilesize: "512K",

    // Max generated connector command file size.
    connectorCommandFileBytes: LENGTH_TIERS.bytes.connectorCommandFile,

    // Default chars retained from terminal/database output when no runtime override is provided.
    connectorOutputChars: LENGTH_TIERS.chars.persistedChunk,

    // Default chars retained by general text/html/markdown cleaners.
    cleanedTextChars: LENGTH_TIERS.chars.cleanedText,

    // Default chars retained by runtime shared text cleaner for large fetched content.
    runtimeCleanAnyChars: LENGTH_TIERS.chars.externalToolHeavy,

    // Short tag text cutoff used by DOM text extraction.
    webMinTagTextChars: LENGTH_TIERS.extractionChars.minTagText,
  },

  dataProcessing: {
    // Max bytes per batched web/doc extraction payload.
    batchBytes: LENGTH_TIERS.bytes.batchPayload,

    // Max bytes read directly as text before file-type-specific parsing is required.
    directTextBytes: LENGTH_TIERS.bytes.directText,

    // Max chars returned directly by web_to_data.
    webTextChars: LENGTH_TIERS.chars.persistedChunk,

    // Sample sizes for lightweight content-type detection and diagnostics.
    webLeadingTextSampleChars: LENGTH_TIERS.chars.persistedChunk,
    webHtmlProbeChars: LENGTH_TIERS.extractionChars.htmlProbe,

    // Max generated web2img page-text artifact chars before truncating payloads.
    web2ImgUsefulTextChars: LENGTH_TIERS.artifactTextChars.web2ImgUsefulText,
    web2ImgFullTextChars: LENGTH_TIERS.artifactTextChars.web2ImgFullText,

    // LibreOffice conversion temp output guard. Actual cap is max(this, input size ratio).
    libreOfficeTempMaxBytes: LENGTH_TIERS.bytes.libreOfficeTempBaseline,
  },

  harness: {
    // Max buffered JSONL bytes before forcing a flush/drop.
    jsonlMaxBufferBytes: LENGTH_TIERS.bytes.jsonlBuffer,
  },

  display: {
    // Context-independent execution log/UI brief text.
    executionLogBriefChars: LENGTH_TIERS.displayChars.executionLogBrief,

    // Context-independent model-context diagnostic preview; does not affect model input.
    modelContextContentChars: LENGTH_TIERS.displayChars.modelContextContent,

    // Context-independent hook/plugin progress text sent to clients.
    hookProgressTextChars: LENGTH_TIERS.displayChars.hookProgressText,

    // Context-independent attachment extension/name display guards.
    attachmentExtensionChars: LENGTH_TIERS.displayChars.extensionName,
    sessionSummaryFileNameChars: LENGTH_TIERS.displayChars.sessionSummaryFileName,

    // Context-independent raw planning output preview for diagnostics.
    planningRawOutputPreviewChars: LENGTH_TIERS.displayChars.planningRawPreview,

    // Context-independent trace/result previews.
    toolResultTraceChars: LENGTH_TIERS.displayChars.shortTrace,
    sessionSummaryObjectFieldChars: LENGTH_TIERS.displayChars.shortTrace,
    mcpTaskResultPreviewChars: LENGTH_TIERS.displayChars.shortTrace,
    harnessPreviewChars: LENGTH_TIERS.displayChars.harnessPreview,
  },

  contextPreview: {
    // Small preview included beside file-backed semantic-transfer results.
    semanticTransferPreviewChars: LENGTH_TIERS.contextPreviewChars.semanticTransferFileBacked,

    // Planning/workflow compact snippets that can feed model-side plugin payloads.
    planningCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    planningContextGoalChars: LENGTH_TIERS.contextPreviewChars.compactPayload,
    workflowCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    workflowPayloadPreviewChars: LENGTH_TIERS.contextPreviewChars.compactPayload,
    workflowResultTextChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowSemanticTextPreviewChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    harnessDynamicPolicyPromptChars: LENGTH_TIERS.contextPreviewChars.dynamicPolicyPrompt,
  },

  preview: {
    // Generic Harness trace/event preview length.
    harnessPreviewChars: LENGTH_TIERS.displayChars.harnessPreview,

    // Harness dynamic policy prompt limit before clipping.
    harnessDynamicPolicyPromptChars: LENGTH_TIERS.contextPreviewChars.dynamicPolicyPrompt,

    // Harness checklist wrapped payload string length guard.
    harnessWrappedPayloadStringChars: LENGTH_TIERS.chars.wrappedPayload,

    // Planning capture compact fields.
    planningCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    planningRawOutputPreviewChars: LENGTH_TIERS.displayChars.planningRawPreview,
    planningContextGoalChars: LENGTH_TIERS.contextPreviewChars.compactPayload,

    // Workflow plugin compact text and persistence previews.
    workflowCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    workflowResultTextChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowSemanticTextPreviewChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowPayloadPreviewChars: LENGTH_TIERS.contextPreviewChars.compactPayload,

    // Agent/runtime diagnostics previews.
    executionLogBriefChars: LENGTH_TIERS.displayChars.executionLogBrief,
    toolResultTraceChars: LENGTH_TIERS.displayChars.shortTrace,
    modelContextContentChars: LENGTH_TIERS.displayChars.modelContextContent,
    hookProgressTextChars: LENGTH_TIERS.displayChars.hookProgressText,
    attachmentExtensionChars: LENGTH_TIERS.displayChars.extensionName,
    sessionSummaryObjectFieldChars: LENGTH_TIERS.displayChars.shortTrace,
    sessionSummaryArrayItemChars: LENGTH_TIERS.displayChars.sessionSummaryArrayItem,
    sessionSummaryDefaultJsonStringChars:
      LENGTH_TIERS.displayChars.sessionSummaryDefaultJsonString,
    sessionSummarySmallJsonStringChars:
      LENGTH_TIERS.displayChars.sessionSummarySmallJsonString,
    sessionSummaryFileNameChars: LENGTH_TIERS.displayChars.sessionSummaryFileName,
    mcpTaskResultPreviewChars: LENGTH_TIERS.displayChars.shortTrace,
    memoryParserCandidatePreviewChars: LENGTH_TIERS.displayChars.memoryParserCandidatePreview,
    memoryParserRawPreviewChars: LENGTH_TIERS.extractionChars.htmlProbe,
    sessionSummaryTextChars: LENGTH_TIERS.displayChars.sessionSummaryText,
  },
});
