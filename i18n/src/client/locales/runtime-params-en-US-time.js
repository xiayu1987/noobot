/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  installers: {
    versionCheckTimeoutMs: {
      name: "OpenVSCode version check timeout",
      description: "Maximum wait when the installer reads the installed OpenVSCode Server version.",
    },
  },
  modelProxy: {
    logRetentionMs: {
      name: "Model proxy log retention",
      description: "Age after which model proxy log files are eligible for cleanup.",
    },
  },
  model: {
    emptyResponseRetryBaseDelayMs: {
      name: "Model empty response retry base delay",
      description: "Waiting period used by model empty response retry base delay.",
    },
    transportRetryBaseDelayMs: {
      name: "Model transport retry base delay",
      description: "Waiting period used by model transport retry base delay.",
    },
    generationTimeoutMs: {
      name: "Model media generation timeout",
      description: "Maximum wait for a model image or video generation request.",
    },
    generationPollIntervalMs: {
      name: "Model media generation poll interval",
      description: "Interval between status checks for asynchronous image or video generation.",
    },
  },
  hooks: {
    defaultTimeoutMs: {
      name: "Hooks default timeout",
      description: "Maximum wait for hooks default timeout.",
    },
  },
  fileMutation: {
    lockPollIntervalMs: {
      name: "File mutation lock poll interval",
      description: "Execution interval for file mutation lock poll interval.",
    },
    lockStaleMs: {
      name: "File mutation lock stale age",
      description: "Age at which a file mutation lock is checked for expiry.",
    },
    lockTimeoutMs: {
      name: "File mutation lock timeout",
      description: "Maximum wait for file mutation lock timeout.",
    },
  },
  runtimeEvents: {
    retentionDays: {
      name: "Runtime event retention",
      description: "Retention period for runtime event files; zero disables age-based cleanup.",
    },
    cleanupIntervalMs: {
      name: "Runtime events cleanup interval",
      description: "Execution interval for runtime events cleanup interval.",
    },
    batchFlushMs: {
      name: "Runtime events batch flush",
      description: "Duration used by runtime events batch flush.",
    },
  },
  connectorInstances: {
    postgresIdleTimeoutMs: {
      name: "Connector instances PostgreSQL idle timeout",
      description: "Maximum wait for connector instances postgresql idle timeout.",
    },
    sshCommandTimeoutMs: {
      name: "Connector instances SSH command timeout",
      description: "Maximum wait for connector instances ssh command timeout.",
    },
    mysqlTimeoutMs: {
      name: "Connector instances MySQL timeout",
      description: "Maximum wait for connector instances mysql timeout.",
    },
    postgresTimeoutMs: {
      name: "Connector instances PostgreSQL timeout",
      description: "Maximum wait for connector instances postgresql timeout.",
    },
    sqliteTimeoutMs: {
      name: "Connector instances SQLite timeout",
      description: "Maximum wait for connector instances sqlite timeout.",
    },
  },
  userTemplate: {
    remoteInstanceCacheTtlMs: {
      name: "User template remote instance cache TTL",
      description: "Retention period for user template remote instance cache ttl.",
    },
  },
  mcp: {
    requestTimeoutMs: {
      name: "MCP request timeout",
      description: "Maximum wait for mcp request timeout.",
    },
  },
  desktop: {
    agentProxyStartupTimeoutMs: {
      name: "Desktop agent proxy startup timeout",
      description: "Maximum wait for desktop agent proxy startup timeout.",
    },
    startupPollIntervalMs: {
      name: "Desktop startup poll interval",
      description: "Execution interval for desktop startup poll interval.",
    },
    crashRestartInitialDelayMs: {
      name: "Desktop crash restart initial delay",
      description: "Waiting period used by desktop crash restart initial delay.",
    },
    crashRestartSecondDelayMs: {
      name: "Desktop crash restart second delay",
      description: "Waiting period used by desktop crash restart second delay.",
    },
    crashRestartFinalDelayMs: {
      name: "Desktop crash restart final delay",
      description: "Waiting period used by desktop crash restart final delay.",
    },
    dependencyDetectIntervalMs: {
      name: "Desktop dependency detect interval",
      description: "Execution interval for desktop dependency detect interval.",
    },
    dependencyDetectTimeoutMs: {
      name: "Desktop dependency detect timeout",
      description: "Maximum wait for desktop dependency detect timeout.",
    },
    dependencyProcessTimeoutMs: {
      name: "Desktop dependency process timeout",
      description: "Maximum wait for desktop dependency process timeout.",
    },
    dependencyProxyProbeTimeoutMs: {
      name: "Desktop dependency proxy probe timeout",
      description: "Maximum wait for desktop dependency proxy probe timeout.",
    },
    crashRestartWindowMs: {
      name: "Desktop crash restart window",
      description: "Window duration used by desktop crash restart window.",
    },
    installerProgressIntervalMs: {
      name: "Desktop installer progress interval",
      description: "Execution interval for desktop installer progress interval.",
    },
    startupProgressReplayDelayMs: {
      name: "Desktop startup progress replay delay",
      description: "Waiting period used by desktop startup progress replay delay.",
    },
    windowRecoveryDelayMs: {
      name: "Desktop window recovery delay",
      description: "Window duration used by desktop window recovery delay.",
    },
    healthProbeTimeoutMs: {
      name: "Desktop health probe timeout",
      description: "Maximum wait for desktop health probe timeout.",
    },
  },
  agent: {
    runTimeoutMs: {
      name: "Agent run timeout",
      description:
        "Default timeout for an agent run, bounded by the configured minimum and maximum.",
    },
    minRunTimeoutMs: {
      name: "Minimum agent run timeout",
      description: "Smallest run timeout a caller may request.",
    },
    maxRunTimeoutMs: {
      name: "Maximum agent run timeout",
      description: "Largest run timeout a caller may request.",
    },
    hookTimeoutMs: {
      name: "Agent hook timeout",
      description: "Maximum wait for agent hook timeout.",
    },
    authorityOutboxDeliveredRetentionMs: {
      name: "Agent authority outbox delivered retention",
      description: "Retention period for agent authority outbox delivered retention.",
    },
    authorityOutboxCompactIntervalMs: {
      name: "Agent authority outbox compact interval",
      description: "Execution interval for agent authority outbox compact interval.",
    },
    snapshotIdentityGuardMs: {
      name: "Agent snapshot identity guard",
      description: "Duration used by agent snapshot identity guard.",
    },
    terminalResolutionRetryDelayMs: {
      name: "Turn terminal resolution retry delay",
      description: "Delay before retrying terminal resolution for a turn.",
    },
  },
  memory: {
    summaryTimeoutMs: {
      name: "Memory summary timeout",
      description: "Maximum wait for memory summary timeout.",
    },
  },
  tools: {
    nativeBrowserMaxWaitMs: {
      name: "Tools native browser max wait",
      description: "Maximum wait for tools native browser max wait.",
    },
    nativeCapabilityGraceMs: {
      name: "Tools native capability grace",
      description: "Waiting period used by tools native capability grace.",
    },
    dockerExecuteTimeoutMs: {
      name: "Tools Docker execute timeout",
      description: "Maximum wait for tools docker execute timeout.",
    },
    nativeScriptForceKillGraceMs: {
      name: "Tools native script force kill grace",
      description: "Waiting period used by tools native script force kill grace.",
    },
    executeScriptTimeoutMs: {
      name: "Tools execute script timeout",
      description: "Maximum wait for tools execute script timeout.",
    },
    browserDevtoolsPortPollIntervalMs: {
      name: "Tools browser devtools port poll interval",
      description: "Execution interval for tools browser devtools port poll interval.",
    },
    processForceKillGraceMs: {
      name: "Tools process force kill grace",
      description: "Waiting period used by tools process force kill grace.",
    },
    processSettleGraceMs: {
      name: "Tools process settle grace",
      description: "Retention period for tools process settle grace.",
    },
    nativeTaskCleanupRetryDelayMs: {
      name: "Tools native task cleanup retry delay",
      description: "Waiting period used by tools native task cleanup retry delay.",
    },
    dockerLockWaitTimeoutMs: {
      name: "Tools Docker lock wait timeout",
      description: "Maximum wait for tools docker lock wait timeout.",
    },
  },
  agentProxy: {
    fixedWindowMs: {
      name: "Agent proxy fixed window",
      description: "Window duration used by agent proxy fixed window.",
    },
    upstreamCloseGraceMs: {
      name: "Agent proxy upstream close grace",
      description: "Waiting period used by agent proxy upstream close grace.",
    },
    reconnectPollIntervalMs: {
      name: "Agent proxy reconnect poll interval",
      description: "Execution interval for agent proxy reconnect poll interval.",
    },
    channelRetentionMs: {
      name: "Agent proxy channel retention",
      description: "Retention period for agent proxy channel retention.",
    },
    apiKeyRetentionMs: {
      name: "Agent proxy API key retention",
      description: "Retention period for agent proxy api key retention.",
    },
    cleanupIntervalMs: {
      name: "Agent proxy cleanup interval",
      description: "Execution interval for agent proxy cleanup interval.",
    },
    requestIdTtlMs: {
      name: "Agent proxy request id TTL",
      description: "Retention period for agent proxy request id ttl.",
    },
    httpUpstreamTimeoutMs: {
      name: "Agent proxy HTTP upstream timeout",
      description: "Maximum wait for agent proxy http upstream timeout.",
    },
    httpRateLimitWindowMs: {
      name: "Agent proxy HTTP rate limit window",
      description: "Window duration used by agent proxy http rate limit window.",
    },
    wsRateLimitWindowMs: {
      name: "Agent proxy ws rate limit window",
      description: "Window duration used by agent proxy ws rate limit window.",
    },
    ideWsRateLimitWindowMs: {
      name: "Agent proxy IDE ws rate limit window",
      description: "Window duration used by agent proxy ide ws rate limit window.",
    },
    ideHttpRateLimitWindowMs: {
      name: "Agent proxy IDE HTTP rate limit window",
      description: "Window duration used by agent proxy ide http rate limit window.",
    },
    webSocketHeartbeatIntervalMs: {
      name: "Agent proxy WebSocket heartbeat interval",
      description: "Execution interval for agent proxy websocket heartbeat interval.",
    },
    webSocketHeartbeatTimeoutMs: {
      name: "Agent proxy WebSocket heartbeat timeout",
      description: "Maximum wait for agent proxy websocket heartbeat timeout.",
    },
    dataPlaneMetricsIntervalMs: {
      name: "Agent proxy data plane metrics interval",
      description: "Execution interval for agent proxy data plane metrics interval.",
    },
    reconnectSnapshotTimeoutMs: {
      name: "Agent proxy reconnect snapshot timeout",
      description: "Maximum wait for agent proxy reconnect snapshot timeout.",
    },
    turnLifecycleReceiptTimeoutMs: {
      name: "Agent proxy turn lifecycle receipt timeout",
      description: "Maximum wait for agent proxy turn lifecycle receipt timeout.",
    },
    invalidUpstreamFrameWindowMs: {
      name: "Agent proxy invalid upstream frame window",
      description: "Window duration used by agent proxy invalid upstream frame window.",
    },
  },
  capability: {
    harnessHookMinTimeoutMs: {
      name: "Capability Harness hook min timeout",
      description: "Maximum wait for capability harness hook min timeout.",
    },
  },
  openvscode: {
    startTimeoutMs: {
      name: "Openvscode start timeout",
      description: "Maximum wait for openvscode start timeout.",
    },
    idleTimeoutMs: {
      name: "Openvscode idle timeout",
      description: "Maximum wait for openvscode idle timeout.",
    },
    cleanupIntervalMs: {
      name: "Openvscode cleanup interval",
      description: "Execution interval for openvscode cleanup interval.",
    },
    shutdownGraceMs: {
      name: "Openvscode shutdown grace",
      description: "Waiting period used by openvscode shutdown grace.",
    },
    touchPersistIntervalMs: {
      name: "Openvscode touch persist interval",
      description: "Execution interval for openvscode touch persist interval.",
    },
    portProbeTimeoutMs: {
      name: "Openvscode port probe timeout",
      description: "Maximum wait for openvscode port probe timeout.",
    },
    waitProbeTimeoutMs: {
      name: "Openvscode wait probe timeout",
      description: "Maximum wait for openvscode wait probe timeout.",
    },
  },
  harness: {
    hookTimeoutMs: {
      name: "Harness hook timeout",
      description: "Maximum wait for harness hook timeout.",
    },
    manifestDebounceMs: {
      name: "Harness manifest debounce",
      description: "Execution interval for harness manifest debounce.",
    },
    manifestCacheMaxAgeMs: {
      name: "Harness manifest cache max age",
      description: "Retention period for harness manifest cache max age.",
    },
    manifestCleanupIntervalMs: {
      name: "Harness manifest cleanup interval",
      description: "Execution interval for harness manifest cleanup interval.",
    },
    jsonlFlushMaxTimeMs: {
      name: "Harness JSONL flush max time",
      description: "Duration used by harness jsonl flush max time.",
    },
    jsonlRetryBaseDelayMs: {
      name: "Harness JSONL retry base delay",
      description: "Waiting period used by harness jsonl retry base delay.",
    },
    jsonlRetryMaxDelayMs: {
      name: "Harness JSONL retry max delay",
      description: "Waiting period used by harness jsonl retry max delay.",
    },
    flushHookTimeoutMs: {
      name: "Harness flush hook timeout",
      description: "Maximum wait for harness flush hook timeout.",
    },
    tmpFileMaxAgeMs: {
      name: "Harness tmp file max age",
      description: "Retention period for harness tmp file max age.",
    },
    tmpCleanupMinIntervalMs: {
      name: "Harness tmp cleanup min interval",
      description: "Execution interval for harness tmp cleanup min interval.",
    },
    cleanupGraceMs: {
      name: "Harness cleanup grace",
      description: "Waiting period used by harness cleanup grace.",
    },
    runWriteLockStaleMs: {
      name: "Harness run write lock stale",
      description: "Duration used by harness run write lock stale.",
    },
    maxRunAgeDays: {
      name: "Harness max run age days",
      description: "Duration used by harness max run age days.",
    },
    fsmCacheMaxAgeMs: {
      name: "Harness FSM cache max age",
      description: "Retention period for harness fsm cache max age.",
    },
    fsmCacheCleanupIntervalMs: {
      name: "Harness FSM cache cleanup interval",
      description: "Execution interval for harness fsm cache cleanup interval.",
    },
    capabilityModelTimeoutMs: {
      name: "Harness capability model timeout",
      description: "Maximum wait for harness capability model timeout.",
    },
    capabilityModelHookGraceMs: {
      name: "Harness capability model hook grace",
      description: "Waiting period used by harness capability model hook grace.",
    },
  },
  workflow: {
    timeoutMs: {
      name: "Workflow timeout",
      description: "Maximum wait for workflow timeout.",
    },
    nodeAgentTimeoutMs: {
      name: "Workflow node agent timeout",
      description: "Maximum wait for workflow node agent timeout.",
    },
  },
  client: {
    sessionLongPressDelayMs: {
      name: "Session long-press delay",
      description: "Hold duration before showing session actions on touch devices.",
    },
    micDurationRefreshIntervalMs: {
      name: "Client mic duration refresh interval",
      description: "Execution interval for client mic duration refresh interval.",
    },
    thinkingElapsedRefreshIntervalMs: {
      name: "Client thinking elapsed refresh interval",
      description: "Execution interval for client thinking elapsed refresh interval.",
    },
    chatMessageNavigatorScrollLockMs: {
      name: "Client chat message navigator scroll lock",
      description: "Duration used by client chat message navigator scroll lock.",
    },
    wsReconnectTimeoutMs: {
      name: "Client ws reconnect timeout",
      description: "Maximum wait for client ws reconnect timeout.",
    },
    sessionLogReconnectBaseDelayMs: {
      name: "Client session log reconnect base delay",
      description: "Waiting period used by client session log reconnect base delay.",
    },
    sessionLogReconnectMaxDelayMs: {
      name: "Client session log reconnect max delay",
      description: "Waiting period used by client session log reconnect max delay.",
    },
    sessionLogDebugTtlMs: {
      name: "Client session log debug TTL",
      description: "Retention period for client session log debug ttl.",
    },
    monotonicActionStopTimeoutMs: {
      name: "Client monotonic action stop timeout",
      description: "Maximum wait for client monotonic action stop timeout.",
    },
    monotonicActionStopPollIntervalMs: {
      name: "Client monotonic action stop poll interval",
      description: "Execution interval for client monotonic action stop poll interval.",
    },
    panelResizeThrottleMs: {
      name: "Client panel resize throttle",
      description: "Execution interval for client panel resize throttle.",
    },
    thinkingDetailRetryDelayMs: {
      name: "Client thinking detail retry delay",
      description: "Waiting period used by client thinking detail retry delay.",
    },
    micMaxDurationSeconds: {
      name: "Client mic max duration seconds",
      description: "Duration used by client mic max duration seconds.",
    },
    terminalTurnRetentionMs: {
      name: "Client terminal turn retention",
      description: "How long the client retains runtime state for completed turns.",
    },
    admissionRetryMinDelayMs: {
      name: "Client admission retry min delay",
      description: "Waiting period used by client admission retry min delay.",
    },
    admissionRetryMaxDelayMs: {
      name: "Client admission retry max delay",
      description: "Waiting period used by client admission retry max delay.",
    },
  },
  service: {
    httpAdmissionWindowMs: {
      name: "HTTP admission window duration",
      description: "Window duration used by http admission window duration.",
    },
    resourceAccessTtlMs: {
      name: "Resource access ticket TTL",
      description: "Validity period of a resource-specific GET/HEAD ticket.",
    },
    apiKeyTtlMs: {
      name: "Service API key TTL",
      description: "Retention period for service api key ttl.",
    },
    orphanedTurnRecoveryGraceMs: {
      name: "Service orphaned turn recovery grace",
      description: "Waiting period used by service orphaned turn recovery grace.",
    },
    userInteractionTimeoutMs: {
      name: "Service user interaction timeout",
      description: "Maximum wait for service user interaction timeout.",
    },
    sessionLogMinIntervalMs: {
      name: "Service session log min interval",
      description: "Execution interval for service session log min interval.",
    },
    startupProgressIntervalMs: {
      name: "Service startup progress interval",
      description: "Execution interval for service startup progress interval.",
    },
    startupHeartbeatIntervalMs: {
      name: "Service startup heartbeat interval",
      description: "Execution interval for service startup heartbeat interval.",
    },
    startupUnresponsiveTimeoutMs: {
      name: "Service startup unresponsive timeout",
      description: "Maximum wait for service startup unresponsive timeout.",
    },
    startupStallTimeoutMs: {
      name: "Service startup stall timeout",
      description: "Maximum wait for service startup stall timeout.",
    },
  },
  cli: {
    healthProbeMs: {
      name: "Cli health probe",
      description: "Maximum wait for cli health probe.",
    },
  },
};
