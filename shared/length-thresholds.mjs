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
    clientNonImagePreview: 1 * MiB,
    searchFile: 2 * MiB,
    jsonlBuffer: 5 * MiB,
    directText: 8 * MiB,
    attachmentFile: 10 * MiB,
    desktopLogFile: 10 * MiB,
    searchBuffer: 16 * MiB,
    attachmentTotal: 30 * MiB,
    libreOfficeTempBaseline: 512 * MiB,
  },
});

export const LENGTH_THRESHOLDS = deepFreeze({
  context: {
    phaseSummaryMessageChars: LENGTH_TIERS.chars.mainContext,

    harnessSummaryMessageChars: LENGTH_TIERS.chars.externalToolHeavy,
  },

  semanticTransfer: {
    directChars: LENGTH_TIERS.chars.persistedChunk,

    toolResultInlineChars: LENGTH_TIERS.chars.persistedChunk,

    toolInputOverflowChars: LENGTH_TIERS.chars.persistedChunk,

    previewChars: LENGTH_TIERS.contextPreviewChars.semanticTransferFileBacked,
  },

  memory: {
    longPromptPayloadChars: LENGTH_TIERS.chars.mainContext,

    fileSplitChars: LENGTH_TIERS.chars.persistedChunk,
  },

  attachments: {
    maxFileSizeBytes: LENGTH_TIERS.bytes.attachmentFile,

    maxTotalSizeBytes: LENGTH_TIERS.bytes.attachmentTotal,
  },

  clientPreview: {
    nonImageMaxBytes: LENGTH_TIERS.bytes.clientNonImagePreview,
  },

  desktopLogging: {
    maxFileBytes: LENGTH_TIERS.bytes.desktopLogFile,
  },

  toolIO: {
    fileContentBytesPrecheckMultiplier: 2,

    searchFileBytes: LENGTH_TIERS.bytes.searchFile,

    searchBufferBytes: LENGTH_TIERS.bytes.searchBuffer,

    ripgrepMaxFilesize: "512K",

    connectorCommandFileBytes: LENGTH_TIERS.bytes.connectorCommandFile,

    connectorOutputChars: LENGTH_TIERS.chars.persistedChunk,

    cleanedTextChars: LENGTH_TIERS.chars.cleanedText,

    runtimeCleanAnyChars: LENGTH_TIERS.chars.externalToolHeavy,

    webMinTagTextChars: LENGTH_TIERS.extractionChars.minTagText,
  },

  dataProcessing: {
    batchBytes: LENGTH_TIERS.bytes.batchPayload,

    directTextBytes: LENGTH_TIERS.bytes.directText,

    webTextChars: LENGTH_TIERS.chars.persistedChunk,

    webLeadingTextSampleChars: LENGTH_TIERS.chars.persistedChunk,
    webHtmlProbeChars: LENGTH_TIERS.extractionChars.htmlProbe,

    web2ImgUsefulTextChars: LENGTH_TIERS.artifactTextChars.web2ImgUsefulText,
    web2ImgFullTextChars: LENGTH_TIERS.artifactTextChars.web2ImgFullText,

    libreOfficeTempMaxBytes: LENGTH_TIERS.bytes.libreOfficeTempBaseline,
  },

  harness: {
    jsonlMaxBufferBytes: LENGTH_TIERS.bytes.jsonlBuffer,
  },

  sessionLog: {
    maxPayloadBytes: LENGTH_TIERS.bytes.connectorCommandFile,
  },

  agentProxy: {
    webSocketMaxPayloadBytes: LENGTH_TIERS.bytes.attachmentFile,
    webSocketMaxBufferedBytes: LENGTH_TIERS.bytes.jsonlBuffer,
  },

  artifact: {
    executionEventSegmentBytes: LENGTH_TIERS.bytes.jsonlBuffer,
  },

  display: {
    executionLogBriefChars: LENGTH_TIERS.displayChars.executionLogBrief,

    modelContextContentChars: LENGTH_TIERS.displayChars.modelContextContent,

    hookProgressTextChars: LENGTH_TIERS.displayChars.hookProgressText,

    attachmentExtensionChars: LENGTH_TIERS.displayChars.extensionName,
    sessionSummaryFileNameChars: LENGTH_TIERS.displayChars.sessionSummaryFileName,

    planningRawOutputPreviewChars: LENGTH_TIERS.displayChars.planningRawPreview,

    toolResultTraceChars: LENGTH_TIERS.displayChars.shortTrace,
    sessionSummaryObjectFieldChars: LENGTH_TIERS.displayChars.shortTrace,
    mcpTaskResultPreviewChars: LENGTH_TIERS.displayChars.shortTrace,
    harnessPreviewChars: LENGTH_TIERS.displayChars.harnessPreview,
  },

  contextPreview: {
    semanticTransferPreviewChars: LENGTH_TIERS.contextPreviewChars.semanticTransferFileBacked,

    planningCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    planningContextGoalChars: LENGTH_TIERS.contextPreviewChars.compactPayload,
    workflowCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    workflowPayloadPreviewChars: LENGTH_TIERS.contextPreviewChars.compactPayload,
    workflowResultTextChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowSemanticTextPreviewChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    harnessDynamicPolicyPromptChars: LENGTH_TIERS.contextPreviewChars.dynamicPolicyPrompt,
  },

  preview: {
    harnessPreviewChars: LENGTH_TIERS.displayChars.harnessPreview,

    harnessDynamicPolicyPromptChars: LENGTH_TIERS.contextPreviewChars.dynamicPolicyPrompt,

    harnessWrappedPayloadStringChars: LENGTH_TIERS.chars.wrappedPayload,

    planningCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    planningRawOutputPreviewChars: LENGTH_TIERS.displayChars.planningRawPreview,
    planningContextGoalChars: LENGTH_TIERS.contextPreviewChars.compactPayload,

    workflowCompactTextChars: LENGTH_TIERS.contextPreviewChars.compactPlanning,
    workflowResultTextChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowSemanticTextPreviewChars: LENGTH_TIERS.contextPreviewChars.structuredWorkflow,
    workflowPayloadPreviewChars: LENGTH_TIERS.contextPreviewChars.compactPayload,

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
