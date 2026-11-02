/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  runtimeEvents: {
    maxArchives: {
      name: "Runtime event archive limit",
      description: "Maximum retained runtime event archives; zero disables count-based cleanup.",
    },
    maxCachedFiles: {
      name: "Runtime events max cached files",
      description: "Count threshold used by runtime events max cached files.",
    },
    batchMaxRecords: {
      name: "Runtime events batch max records",
      description: "Count threshold used by runtime events batch max records.",
    },
  },
  connectorInstances: {
    mysqlPoolLimit: {
      name: "Connector instances MySQL pool limit",
      description: "Count threshold used by connector instances mysql pool limit.",
    },
    postgresPoolMax: {
      name: "Connector instances PostgreSQL pool max",
      description: "Count threshold used by connector instances postgresql pool max.",
    },
  },
  eventProtocol: {
    authorityOutboxPendingBatchSize: {
      name: "Event protocol authority outbox pending batch size",
      description: "Count threshold used by event protocol authority outbox pending batch size.",
    },
  },
  longMemory: {
    workAssistantCollaborationMaxItems: {
      name: "Long memory work assistant collaboration max items",
      description: "Count threshold used by long memory work assistant collaboration max items.",
    },
    workQualityStandardsMaxItems: {
      name: "Long memory work quality standards max items",
      description: "Count threshold used by long memory work quality standards max items.",
    },
    workWorkStyleMaxItems: {
      name: "Long memory work work style max items",
      description: "Count threshold used by long memory work work style max items.",
    },
    workToolsMethodsMaxItems: {
      name: "Long memory work tools methods max items",
      description: "Count threshold used by long memory work tools methods max items.",
    },
    workLongTermProjectsMaxItems: {
      name: "Long memory work long term projects max items",
      description: "Count threshold used by long memory work long term projects max items.",
    },
    historyPreferencesCommonTopicsMaxItems: {
      name: "Long memory history preferences common topics max items",
      description:
        "Count threshold used by long memory history preferences common topics max items.",
    },
    socialImportantRelationshipsMaxItems: {
      name: "Long memory social important relationships max items",
      description: "Count threshold used by long memory social important relationships max items.",
    },
    personalityEmotionalTendenciesMaxItems: {
      name: "Long memory personality emotional tendencies max items",
      description:
        "Count threshold used by long memory personality emotional tendencies max items.",
    },
    personalityTraitsMaxItems: {
      name: "Long memory personality traits max items",
      description: "Count threshold used by long memory personality traits max items.",
    },
    interestsPreferredActivitiesMaxItems: {
      name: "Long memory interests preferred activities max items",
      description: "Count threshold used by long memory interests preferred activities max items.",
    },
    interestsFavoriteMusicMaxItems: {
      name: "Long memory interests favorite music max items",
      description: "Count threshold used by long memory interests favorite music max items.",
    },
    interestsFavoriteMoviesMaxItems: {
      name: "Long memory interests favorite movies max items",
      description: "Count threshold used by long memory interests favorite movies max items.",
    },
    interestsFavoriteBooksMaxItems: {
      name: "Long memory interests favorite books max items",
      description: "Count threshold used by long memory interests favorite books max items.",
    },
    interestsHobbiesMaxItems: {
      name: "Long memory interests hobbies max items",
      description: "Count threshold used by long memory interests hobbies max items.",
    },
  },
  contextProtocol: {
    turnSummaryCheckpointReceiptLimit: {
      name: "Context protocol turn summary checkpoint receipt limit",
      description:
        "Count threshold used by context protocol turn summary checkpoint receipt limit.",
    },
  },
  memory: {
    maxItems: {
      name: "Memory item limit",
      description: "Maximum number of items retained during memory processing.",
    },
  },
  attachments: {
    maxFileCount: {
      name: "Attachments max file count",
      description: "Count threshold used by attachments max file count.",
    },
  },
  toolIO: {
    readMaxLines: {
      name: "Default file read line limit",
      description:
        "Default line limit when the caller omits it; must not exceed the hard line limit.",
    },
    readMaxLinesLimit: {
      name: "Hard file read line limit",
      description: "Largest line limit allowed in a file read request.",
    },
    searchMaxResults: {
      name: "Default search result limit",
      description: "Default result limit when the caller does not specify one.",
    },
    searchMaxResultsLimit: {
      name: "Hard search result limit",
      description: "Largest result count allowed in a search request.",
    },
    searchContextLines: {
      name: "Default search context lines",
      description: "Default surrounding lines for each search hit; zero omits context.",
    },
    searchContextLinesLimit: {
      name: "Hard search context line limit",
      description: "Largest surrounding line count allowed in a search request.",
    },
    patchFailureContextRadius: {
      name: "Tool IO patch failure context radius",
      description: "Count threshold used by tool io patch failure context radius.",
    },
  },
  diagnostics: {
    modelContextPreviewLimit: {
      name: "Diagnostics model context preview limit",
      description: "Count threshold used by diagnostics model context preview limit.",
    },
    executionReportSlowestToolCalls: {
      name: "Diagnostics execution report slowest tool calls",
      description: "Count threshold used by diagnostics execution report slowest tool calls.",
    },
  },
  web: {
    maxRedirects: {
      name: "Web max redirects",
      description: "Count threshold used by web max redirects.",
    },
    readableExtractMaxLines: {
      name: "Web readable extract max lines",
      description: "Count threshold used by web readable extract max lines.",
    },
    textMaxLines: {
      name: "Web text max lines",
      description: "Count threshold used by web text max lines.",
    },
  },
  desktop: {
    logRetainCount: {
      name: "Desktop log retain count",
      description: "Count threshold used by desktop log retain count.",
    },
  },
  harness: {
    jsonlFlushMaxSize: {
      name: "Harness JSONL flush max size",
      description: "Count threshold used by harness jsonl flush max size.",
    },
    jsonlMaxBufferEntries: {
      name: "Harness JSONL max buffer entries",
      description: "Count threshold used by harness jsonl max buffer entries.",
    },
    jsonlMaxFiles: {
      name: "Harness JSONL max files",
      description: "Count threshold used by harness jsonl max files.",
    },
    maxRuns: {
      name: "Harness max runs",
      description: "Count threshold used by harness max runs.",
    },
    completedDialogIds: {
      name: "Harness completed dialog ids",
      description: "Count threshold used by harness completed dialog ids.",
    },
    incrementalMessageCacheEntries: {
      name: "Harness incremental message cache entries",
      description: "Count threshold used by harness incremental message cache entries.",
    },
  },
  client: {
    resendDebugLimit: {
      name: "Client resend debug limit",
      description: "Count threshold used by client resend debug limit.",
    },
    toolLogDebugLimit: {
      name: "Client tool log debug limit",
      description: "Count threshold used by client tool log debug limit.",
    },
    consumedEventIdsLimit: {
      name: "Client consumed event ids limit",
      description: "Count threshold used by client consumed event ids limit.",
    },
    executionLogDisplayLimit: {
      name: "Client execution log display limit",
      description: "Count threshold used by client execution log display limit.",
    },
    messageAnchorScrollOffsetPx: {
      name: "Client message anchor scroll offset",
      description:
        "Fixed constraint for client message anchor scroll offset; not editable at runtime.",
    },
    messageAnchorCurrentThresholdPx: {
      name: "Client message anchor current threshold",
      description:
        "Fixed constraint for client message anchor current threshold; not editable at runtime.",
    },
    messageListEstimatedRowHeightPx: {
      name: "Client message list estimated row height",
      description:
        "Fixed constraint for client message list estimated row height; not editable at runtime.",
    },
    messageListInitialViewportHeightPx: {
      name: "Client message list initial viewport height",
      description:
        "Fixed constraint for client message list initial viewport height; not editable at runtime.",
    },
    messageListVirtualOverscan: {
      name: "Client message list virtual overscan",
      description: "Count threshold used by client message list virtual overscan.",
    },
    thinkingDetailEstimatedRowHeightPx: {
      name: "Client thinking detail estimated row height",
      description:
        "Fixed constraint for client thinking detail estimated row height; not editable at runtime.",
    },
    thinkingDetailInitialViewportHeightPx: {
      name: "Client thinking detail initial viewport height",
      description:
        "Fixed constraint for client thinking detail initial viewport height; not editable at runtime.",
    },
    thinkingDetailVirtualOverscan: {
      name: "Client thinking detail virtual overscan",
      description: "Count threshold used by client thinking detail virtual overscan.",
    },
    thinkingDetailRetryLimit: {
      name: "Client thinking detail retry limit",
      description: "Count threshold used by client thinking detail retry limit.",
    },
    frameHealthTopScriptLimit: {
      name: "Client frame health top script limit",
      description: "Count threshold used by client frame health top script limit.",
    },
    sessionListRecentDayGroupCount: {
      name: "Client session list recent day group count",
      description: "Count threshold used by client session list recent day group count.",
    },
  },
  sessionLog: {
    maxBatchSize: {
      name: "Session log max batch size",
      description: "Count threshold used by session log max batch size.",
    },
    maxQueueSize: {
      name: "Session log max queue size",
      description: "Count threshold used by session log max queue size.",
    },
    maxDebugQueueSize: {
      name: "Session log max debug queue size",
      description: "Count threshold used by session log max debug queue size.",
    },
  },
  agentProxy: {
    fixedWindowMaxRequests: {
      name: "Agent proxy fixed window max requests",
      description: "Count threshold used by agent proxy fixed window max requests.",
    },
    maxChannelEvents: {
      name: "Channel event cache limit",
      description: "Maximum event count retained for each proxy channel.",
    },
    maxConnections: {
      name: "Agent proxy connection limit",
      description: "Maximum simultaneous connections retained by the agent proxy.",
    },
    httpRateLimitMaxRequests: {
      name: "Agent proxy HTTP rate limit max requests",
      description: "Count threshold used by agent proxy http rate limit max requests.",
    },
    wsRateLimitMaxUpgrades: {
      name: "Agent proxy ws rate limit max upgrades",
      description: "Count threshold used by agent proxy ws rate limit max upgrades.",
    },
    ideWsRateLimitMaxUpgrades: {
      name: "Agent proxy IDE ws rate limit max upgrades",
      description: "Count threshold used by agent proxy ide ws rate limit max upgrades.",
    },
    ideHttpRateLimitMaxRequests: {
      name: "Agent proxy IDE HTTP rate limit max requests",
      description: "Count threshold used by agent proxy ide http rate limit max requests.",
    },
    maxReplayEvents: {
      name: "Event replay limit",
      description: "Maximum number of events processed by proxy replay.",
    },
    invalidUpstreamFrameLimit: {
      name: "Agent proxy invalid upstream frame limit",
      description: "Count threshold used by agent proxy invalid upstream frame limit.",
    },
    commandRemovalHistoryLimit: {
      name: "Agent proxy command removal history limit",
      description: "Count threshold used by agent proxy command removal history limit.",
    },
  },
  service: {
    httpConnectionLimit: {
      name: "Connection requests per window",
      description: "Count threshold used by connection requests per window.",
    },
    httpMutationLimit: {
      name: "Mutation requests per window",
      description: "Count threshold used by mutation requests per window.",
    },
    httpReadLimit: {
      name: "Read requests per window",
      description: "Count threshold used by read requests per window.",
    },
  },
};
