/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  modelMeasurement: {
    prefixCompareBlockBytes: {
      name: "Request prefix comparison block",
      description: "Bytes compared per block before locating the first differing byte.",
    },
  },
  runtimeEvents: {
    maxFileBytes: {
      name: "Runtime event file size limit",
      description:
        "File size that triggers runtime event rotation; zero disables size-based rotation.",
    },
  },
  modelProxy: {
    logFileBytes: {
      name: "Model proxy log file",
      description: "Length or capacity threshold used by model proxy log file.",
    },
  },
  diagnostics: {
    responseBytes: {
      name: "Diagnostics response",
      description: "Length or capacity threshold used by diagnostics response.",
    },
  },
  userTemplate: {
    limitedContentChars: {
      name: "User template limited content",
      description: "Length or capacity threshold used by user template limited content.",
    },
  },
  connectorSecrets: {
    keyBytes: {
      name: "Connector encryption key length",
      description: "Key length required by the encryption algorithm; a fixed constraint.",
    },
    initializationVectorBytes: {
      name: "Connector initialization vector length",
      description:
        "Initialization vector length required by the encryption algorithm; a fixed constraint.",
    },
    saltBytes: {
      name: "Connector encryption salt length",
      description: "Salt length required for key derivation; a fixed constraint.",
    },
  },
  context: {
    phaseSummaryMessageChars: {
      name: "Context phase summary message",
      description: "Length or capacity threshold used by context phase summary message.",
    },
    harnessSummaryMessageChars: {
      name: "Context Harness summary message",
      description: "Length or capacity threshold used by context harness summary message.",
    },
  },
  semanticTransfer: {
    directChars: {
      name: "Direct semantic transfer text limit",
      description: "Text length threshold for direct transfer rather than file-backed transfer.",
    },
    toolResultInlineChars: {
      name: "Inline tool result limit",
      description: "Text length threshold for passing a tool result inline.",
    },
    toolInputOverflowChars: {
      name: "Tool input overflow threshold",
      description: "Text length threshold that routes tool input through overflow handling.",
    },
    previewChars: {
      name: "Semantic transfer preview",
      description: "Length or capacity threshold used by semantic transfer preview.",
    },
  },
  memory: {
    longPromptPayloadChars: {
      name: "Memory long prompt payload",
      description: "Length or capacity threshold used by memory long prompt payload.",
    },
    fileSplitChars: {
      name: "Memory file split",
      description: "Length or capacity threshold used by memory file split.",
    },
    parserCandidatePreviewChars: {
      name: "Memory parser candidate preview",
      description: "Length or capacity threshold used by memory parser candidate preview.",
    },
    parserRawPreviewChars: {
      name: "Memory parser raw preview",
      description: "Length or capacity threshold used by memory parser raw preview.",
    },
  },
  attachments: {
    maxFileSizeBytes: {
      name: "Individual attachment size limit",
      description: "Maximum size of one attachment; must not exceed the total attachment limit.",
    },
    maxTotalSizeBytes: {
      name: "Total attachment size limit",
      description: "Maximum combined size of an attachment batch.",
    },
  },
  clientPreview: {
    resourceMaxBytes: {
      name: "Preview resource size",
      description: "Maximum bytes read for one authorized preview resource.",
    },
    resourceTotalBytes: {
      name: "Preview resource budget",
      description: "Maximum combined bytes of authorized files loaded for one document preview.",
    },
    nonImageMaxBytes: {
      name: "Client preview non image max",
      description: "Length or capacity threshold used by client preview non image max.",
    },
    chatMessageNavChars: {
      name: "Client preview chat message nav",
      description: "Length or capacity threshold used by client preview chat message nav.",
    },
  },
  desktopLogging: {
    maxFileBytes: {
      name: "Desktop logging max file",
      description: "Length or capacity threshold used by desktop logging max file.",
    },
  },
  serviceHttp: {
    jsonBodyBytes: {
      name: "Service HTTP JSON body",
      description: "Length or capacity threshold used by service http json body.",
    },
    workspaceFileBytes: {
      name: "Service HTTP workspace file",
      description: "Length or capacity threshold used by service http workspace file.",
    },
    workspaceAssetFileBytes: {
      name: "Service HTTP workspace asset file",
      description: "Length or capacity threshold used by service http workspace asset file.",
    },
  },
  installers: {
    versionOutputBytes: {
      name: "OpenVSCode version output limit",
      description: "Maximum bytes accepted from the OpenVSCode Server version command.",
    },
    openVscodeArchiveBytes: {
      name: "OpenVSCode archive size limit",
      description: "Maximum bytes the installer downloads for the OpenVSCode Server archive.",
    },
  },
  toolIO: {
    connectorCommandFileBytes: {
      name: "Tool IO connector command file",
      description: "Length or capacity threshold used by tool io connector command file.",
    },
    cleanedTextChars: {
      name: "Tool IO cleaned text",
      description: "Length or capacity threshold used by tool io cleaned text.",
    },
    runtimeCleanAnyChars: {
      name: "Tool IO runtime clean any",
      description: "Length or capacity threshold used by tool io runtime clean any.",
    },
    webMinTagTextChars: {
      name: "Tool IO web min tag text",
      description: "Length or capacity threshold used by tool io web min tag text.",
    },
  },
  nativeScript: {
    resultBytes: {
      name: "Native script result",
      description: "Length or capacity threshold used by native script result.",
    },
    sourceBytes: {
      name: "Native script source size limit",
      description: "Maximum source size allowed in a native script execution request.",
    },
    textReadBytes: {
      name: "Native script text read",
      description: "Length or capacity threshold used by native script text read.",
    },
    binaryReadBytes: {
      name: "Native script binary read",
      description: "Length or capacity threshold used by native script binary read.",
    },
    processOutputBytes: {
      name: "Native script process output",
      description: "Length or capacity threshold used by native script process output.",
    },
    inputTotalBytes: {
      name: "Native script input total",
      description: "Length or capacity threshold used by native script input total.",
    },
    artifactTotalBytes: {
      name: "Native script artifact total",
      description: "Length or capacity threshold used by native script artifact total.",
    },
  },
  dataProcessing: {
    responsesFileInputBytes: {
      name: "Data processing responses file input",
      description: "Length or capacity threshold used by data processing responses file input.",
    },
  },
  harness: {
    jsonlFileBytes: {
      name: "Harness JSONL file",
      description: "Length or capacity threshold used by harness jsonl file.",
    },
    jsonlMaxBufferBytes: {
      name: "Harness JSONL max buffer",
      description: "Length or capacity threshold used by harness jsonl max buffer.",
    },
    relayInjectionMaxChars: {
      name: "Harness relay injection max",
      description: "Length or capacity threshold used by harness relay injection max.",
    },
  },
  pluginMessage: {
    payloadBytes: {
      name: "Plugin message payload",
      description: "Length or capacity threshold used by plugin message payload.",
    },
  },
  sessionLog: {
    maxDebugQueueBytes: {
      name: "Session log max debug queue",
      description: "Length or capacity threshold used by session log max debug queue.",
    },
    messageChars: {
      name: "Session log message",
      description: "Length or capacity threshold used by session log message.",
    },
    identityChars: {
      name: "Session log identity",
      description: "Fixed constraint for session log identity; not editable at runtime.",
    },
    levelChars: {
      name: "Session log level",
      description: "Fixed constraint for session log level; not editable at runtime.",
    },
    sourceChars: {
      name: "Session log source",
      description: "Length or capacity threshold used by session log source.",
    },
    maxPayloadBytes: {
      name: "Session log max payload",
      description: "Length or capacity threshold used by session log max payload.",
    },
  },
  agentProxy: {
    maxBodyBytes: {
      name: "Agent proxy request body size limit",
      description: "Maximum HTTP request body size accepted by the agent proxy.",
    },
    webSocketMaxPayloadBytes: {
      name: "Agent proxy WebSocket max payload",
      description: "Length or capacity threshold used by agent proxy websocket max payload.",
    },
    webSocketMaxBufferedBytes: {
      name: "Agent proxy WebSocket max buffered",
      description: "Length or capacity threshold used by agent proxy websocket max buffered.",
    },
  },
  artifact: {
    executionEventSegmentBytes: {
      name: "Artifact execution event segment",
      description: "Length or capacity threshold used by artifact execution event segment.",
    },
    turnMaterializerCacheBytes: {
      name: "Artifact turn materializer cache",
      description: "Length or capacity threshold used by artifact turn materializer cache.",
    },
    verifiedSnapshotCacheBytes: {
      name: "Artifact verified snapshot cache",
      description: "Length or capacity threshold used by artifact verified snapshot cache.",
    },
    verifiedCheckpointIdentityCacheBytes: {
      name: "Artifact verified checkpoint identity cache",
      description:
        "Length or capacity threshold used by artifact verified checkpoint identity cache.",
    },
  },
  display: {
    toolOperationSubjectChars: {
      name: "Display tool operation subject",
      description: "Length or capacity threshold used by display tool operation subject.",
    },
    modelContextContentChars: {
      name: "Display model context content",
      description: "Length or capacity threshold used by display model context content.",
    },
    hookProgressTextChars: {
      name: "Display hook progress text",
      description: "Length or capacity threshold used by display hook progress text.",
    },
    attachmentExtensionChars: {
      name: "Display attachment extension",
      description: "Length or capacity threshold used by display attachment extension.",
    },
    planningRawOutputPreviewChars: {
      name: "Display planning raw output preview",
      description: "Length or capacity threshold used by display planning raw output preview.",
    },
    toolResultTraceChars: {
      name: "Display tool result trace",
      description: "Length or capacity threshold used by display tool result trace.",
    },
    mcpTaskResultPreviewChars: {
      name: "Display MCP task result preview",
      description: "Length or capacity threshold used by display mcp task result preview.",
    },
    harnessPreviewChars: {
      name: "Display Harness preview",
      description: "Length or capacity threshold used by display harness preview.",
    },
    sessionSummaryArrayItemChars: {
      name: "Display session summary array item",
      description: "Length or capacity threshold used by display session summary array item.",
    },
  },
  contextPreview: {
    planningCompactTextChars: {
      name: "Context preview planning compact text",
      description: "Length or capacity threshold used by context preview planning compact text.",
    },
    planningContextGoalChars: {
      name: "Context preview planning context goal",
      description: "Length or capacity threshold used by context preview planning context goal.",
    },
    workflowCompactTextChars: {
      name: "Context preview workflow compact text",
      description: "Length or capacity threshold used by context preview workflow compact text.",
    },
    workflowResultTextChars: {
      name: "Context preview workflow result text",
      description: "Length or capacity threshold used by context preview workflow result text.",
    },
    workflowSemanticTextPreviewChars: {
      name: "Context preview workflow semantic text preview",
      description:
        "Length or capacity threshold used by context preview workflow semantic text preview.",
    },
    harnessDynamicPolicyPromptChars: {
      name: "Context preview Harness dynamic policy prompt",
      description:
        "Length or capacity threshold used by context preview harness dynamic policy prompt.",
    },
  },
};
