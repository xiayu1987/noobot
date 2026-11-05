/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  installers: {
    versionCheckTimeoutMs: {
      name: "OpenVSCode 版本检查超时",
      description: "安装器读取已安装 OpenVSCode Server 版本时的最长等待时间。",
    },
  },
  modelProxy: {
    logRetentionMs: {
      name: "模型代理日志保留时长",
      description: "超过此时长的模型代理日志可被清理。",
    },
  },
  model: {
    emptyResponseRetryBaseDelayMs: {
      name: "模型空响应重试基础延迟",
      description: "模型空响应重试基础延迟使用的等待时长。",
    },
    transportRetryBaseDelayMs: {
      name: "模型传输重试基础延迟",
      description: "模型传输重试基础延迟使用的等待时长。",
    },
  },
  hooks: {
    defaultTimeoutMs: {
      name: "钩子默认超时",
      description: "钩子默认超时的最长等待时间。",
    },
  },
  fileMutation: {
    lockPollIntervalMs: {
      name: "文件修改锁轮询间隔",
      description: "文件修改锁轮询间隔使用的执行间隔。",
    },
    lockStaleMs: {
      name: "文件修改锁过期时长",
      description: "文件修改锁超过此时长后进入过期检查。",
    },
    lockTimeoutMs: {
      name: "文件修改锁超时",
      description: "文件修改锁超时的最长等待时间。",
    },
  },
  runtimeEvents: {
    retentionDays: {
      name: "运行事件保留天数",
      description: "运行事件文件的保留期限；设为 0 关闭按时间清理。",
    },
    cleanupIntervalMs: {
      name: "运行时事件清理间隔",
      description: "运行时事件清理间隔使用的执行间隔。",
    },
    batchFlushMs: {
      name: "运行时事件批次刷盘",
      description: "运行时事件批次刷盘使用的持续时长。",
    },
  },
  connectorInstances: {
    postgresIdleTimeoutMs: {
      name: "连接器实例PostgreSQL空闲超时",
      description: "连接器实例PostgreSQL空闲超时的最长等待时间。",
    },
    sshCommandTimeoutMs: {
      name: "连接器实例SSH命令超时",
      description: "连接器实例SSH命令超时的最长等待时间。",
    },
    mysqlTimeoutMs: {
      name: "连接器实例MySQL超时",
      description: "连接器实例MySQL超时的最长等待时间。",
    },
    postgresTimeoutMs: {
      name: "连接器实例PostgreSQL超时",
      description: "连接器实例PostgreSQL超时的最长等待时间。",
    },
    sqliteTimeoutMs: {
      name: "连接器实例SQLite超时",
      description: "连接器实例SQLite超时的最长等待时间。",
    },
  },
  userTemplate: {
    remoteInstanceCacheTtlMs: {
      name: "用户模板远程实例缓存有效期",
      description: "用户模板远程实例缓存有效期使用的保留期限。",
    },
  },
  mcp: {
    requestTimeoutMs: {
      name: "MCP请求超时",
      description: "MCP请求超时的最长等待时间。",
    },
  },
  desktop: {
    agentProxyStartupTimeoutMs: {
      name: "桌面端智能体代理启动超时",
      description: "桌面端智能体代理启动超时的最长等待时间。",
    },
    startupPollIntervalMs: {
      name: "桌面端启动轮询间隔",
      description: "桌面端启动轮询间隔使用的执行间隔。",
    },
    crashRestartInitialDelayMs: {
      name: "桌面端崩溃重启初始延迟",
      description: "桌面端崩溃重启初始延迟使用的等待时长。",
    },
    crashRestartSecondDelayMs: {
      name: "桌面端崩溃重启第二次延迟",
      description: "桌面端崩溃重启第二次延迟使用的等待时长。",
    },
    crashRestartFinalDelayMs: {
      name: "桌面端崩溃重启最后一次延迟",
      description: "桌面端崩溃重启最后一次延迟使用的等待时长。",
    },
    dependencyDetectIntervalMs: {
      name: "桌面端依赖检测间隔",
      description: "桌面端依赖检测间隔使用的执行间隔。",
    },
    dependencyDetectTimeoutMs: {
      name: "桌面端依赖检测超时",
      description: "桌面端依赖检测超时的最长等待时间。",
    },
    dependencyProcessTimeoutMs: {
      name: "桌面端依赖进程超时",
      description: "桌面端依赖进程超时的最长等待时间。",
    },
    dependencyProxyProbeTimeoutMs: {
      name: "桌面端依赖代理探测超时",
      description: "桌面端依赖代理探测超时的最长等待时间。",
    },
    crashRestartWindowMs: {
      name: "桌面端崩溃重启窗口",
      description: "桌面端崩溃重启窗口使用的统计或状态跟踪窗口时长。",
    },
    installerProgressIntervalMs: {
      name: "桌面端安装器进度间隔",
      description: "桌面端安装器进度间隔使用的执行间隔。",
    },
    startupProgressReplayDelayMs: {
      name: "桌面端启动进度重放延迟",
      description: "桌面端启动进度重放延迟使用的等待时长。",
    },
    windowRecoveryDelayMs: {
      name: "桌面端窗口恢复延迟",
      description: "桌面端窗口恢复延迟使用的统计或状态跟踪窗口时长。",
    },
    healthProbeTimeoutMs: {
      name: "桌面端健康检查探测超时",
      description: "桌面端健康检查探测超时的最长等待时间。",
    },
  },
  agent: {
    runTimeoutMs: {
      name: "智能体运行超时",
      description: "单次智能体运行使用的默认超时，必须位于允许的最小值和最大值之间。",
    },
    minRunTimeoutMs: {
      name: "智能体运行超时下限",
      description: "调用方指定运行超时时允许的最小值。",
    },
    maxRunTimeoutMs: {
      name: "智能体运行超时上限",
      description: "调用方指定运行超时时允许的最大值。",
    },
    hookTimeoutMs: {
      name: "智能体钩子超时",
      description: "智能体钩子超时的最长等待时间。",
    },
    authorityOutboxDeliveredRetentionMs: {
      name: "智能体权威状态发件箱已送达保留",
      description: "智能体权威状态发件箱已送达保留使用的保留期限。",
    },
    authorityOutboxCompactIntervalMs: {
      name: "智能体权威状态发件箱压缩间隔",
      description: "智能体权威状态发件箱压缩间隔使用的执行间隔。",
    },
    snapshotIdentityGuardMs: {
      name: "智能体快照身份保护",
      description: "智能体快照身份保护使用的持续时长。",
    },
    terminalResolutionRetryDelayMs: {
      name: "轮次终态裁定重试间隔",
      description: "轮次终态裁定重试前等待的时长。",
    },
  },
  memory: {
    summaryTimeoutMs: {
      name: "记忆摘要超时",
      description: "记忆摘要超时的最长等待时间。",
    },
  },
  tools: {
    nativeBrowserMaxWaitMs: {
      name: "工具原生浏览器最大等待",
      description: "工具原生浏览器最大等待的最长等待时间。",
    },
    nativeCapabilityGraceMs: {
      name: "工具原生能力宽限",
      description: "工具原生能力宽限使用的等待时长。",
    },
    dockerExecuteTimeoutMs: {
      name: "工具Docker执行超时",
      description: "工具Docker执行超时的最长等待时间。",
    },
    nativeScriptForceKillGraceMs: {
      name: "工具原生脚本强制终止宽限",
      description: "工具原生脚本强制终止宽限使用的等待时长。",
    },
    executeScriptTimeoutMs: {
      name: "工具执行脚本超时",
      description: "工具执行脚本超时的最长等待时间。",
    },
    browserDevtoolsPortPollIntervalMs: {
      name: "工具浏览器开发工具端口轮询间隔",
      description: "工具浏览器开发工具端口轮询间隔使用的执行间隔。",
    },
    imagesAsyncPollIntervalMs: {
      name: "工具图片异步轮询间隔",
      description: "工具图片异步轮询间隔使用的执行间隔。",
    },
    imagesAsyncTimeoutMs: {
      name: "工具图片异步超时",
      description: "工具图片异步超时的最长等待时间。",
    },
    processForceKillGraceMs: {
      name: "工具进程强制终止宽限",
      description: "工具进程强制终止宽限使用的等待时长。",
    },
    processSettleGraceMs: {
      name: "工具进程收尾宽限",
      description: "工具进程收尾宽限使用的保留期限。",
    },
    nativeTaskCleanupRetryDelayMs: {
      name: "工具原生任务清理重试延迟",
      description: "工具原生任务清理重试延迟使用的等待时长。",
    },
    dockerLockWaitTimeoutMs: {
      name: "工具Docker锁等待超时",
      description: "工具Docker锁等待超时的最长等待时间。",
    },
  },
  agentProxy: {
    fixedWindowMs: {
      name: "智能体代理固定窗口",
      description: "智能体代理固定窗口使用的统计或状态跟踪窗口时长。",
    },
    upstreamCloseGraceMs: {
      name: "智能体代理上游关闭宽限",
      description: "智能体代理上游关闭宽限使用的等待时长。",
    },
    reconnectPollIntervalMs: {
      name: "智能体代理重连轮询间隔",
      description: "智能体代理重连轮询间隔使用的执行间隔。",
    },
    channelRetentionMs: {
      name: "智能体代理通道保留",
      description: "智能体代理通道保留使用的保留期限。",
    },
    apiKeyRetentionMs: {
      name: "智能体代理API密钥保留",
      description: "智能体代理API密钥保留使用的保留期限。",
    },
    cleanupIntervalMs: {
      name: "智能体代理清理间隔",
      description: "智能体代理清理间隔使用的执行间隔。",
    },
    requestIdTtlMs: {
      name: "智能体代理请求标识有效期",
      description: "智能体代理请求标识有效期使用的保留期限。",
    },
    httpUpstreamTimeoutMs: {
      name: "智能体代理HTTP上游超时",
      description: "智能体代理HTTP上游超时的最长等待时间。",
    },
    httpRateLimitWindowMs: {
      name: "智能体代理HTTP速率上限窗口",
      description: "智能体代理HTTP速率上限窗口使用的统计或状态跟踪窗口时长。",
    },
    wsRateLimitWindowMs: {
      name: "智能体代理WebSocket速率上限窗口",
      description: "智能体代理WebSocket速率上限窗口使用的统计或状态跟踪窗口时长。",
    },
    ideWsRateLimitWindowMs: {
      name: "智能体代理IDEWebSocket速率上限窗口",
      description: "智能体代理IDEWebSocket速率上限窗口使用的统计或状态跟踪窗口时长。",
    },
    ideHttpRateLimitWindowMs: {
      name: "智能体代理IDEHTTP速率上限窗口",
      description: "智能体代理IDEHTTP速率上限窗口使用的统计或状态跟踪窗口时长。",
    },
    webSocketHeartbeatIntervalMs: {
      name: "智能体代理WebSocket心跳间隔",
      description: "智能体代理WebSocket心跳间隔使用的执行间隔。",
    },
    webSocketHeartbeatTimeoutMs: {
      name: "智能体代理WebSocket心跳超时",
      description: "智能体代理WebSocket心跳超时的最长等待时间。",
    },
    dataPlaneMetricsIntervalMs: {
      name: "智能体代理数据平面指标间隔",
      description: "智能体代理数据平面指标间隔使用的执行间隔。",
    },
    reconnectSnapshotTimeoutMs: {
      name: "智能体代理重连快照超时",
      description: "智能体代理重连快照超时的最长等待时间。",
    },
    turnLifecycleReceiptTimeoutMs: {
      name: "智能体代理轮次生命周期回执超时",
      description: "智能体代理轮次生命周期回执超时的最长等待时间。",
    },
    invalidUpstreamFrameWindowMs: {
      name: "智能体代理无效上游帧窗口",
      description: "智能体代理无效上游帧窗口使用的统计或状态跟踪窗口时长。",
    },
  },
  capability: {
    harnessHookMinTimeoutMs: {
      name: "能力Harness钩子最小超时",
      description: "能力Harness钩子最小超时的最长等待时间。",
    },
  },
  openvscode: {
    startTimeoutMs: {
      name: "OpenVSCode启动超时",
      description: "OpenVSCode启动超时的最长等待时间。",
    },
    idleTimeoutMs: {
      name: "OpenVSCode空闲超时",
      description: "OpenVSCode空闲超时的最长等待时间。",
    },
    cleanupIntervalMs: {
      name: "OpenVSCode清理间隔",
      description: "OpenVSCode清理间隔使用的执行间隔。",
    },
    shutdownGraceMs: {
      name: "OpenVSCode关闭宽限",
      description: "OpenVSCode关闭宽限使用的等待时长。",
    },
    touchPersistIntervalMs: {
      name: "OpenVSCode访问续期持久化间隔",
      description: "OpenVSCode访问续期持久化间隔使用的执行间隔。",
    },
    portProbeTimeoutMs: {
      name: "OpenVSCode端口探测超时",
      description: "OpenVSCode端口探测超时的最长等待时间。",
    },
    waitProbeTimeoutMs: {
      name: "OpenVSCode等待探测超时",
      description: "OpenVSCode等待探测超时的最长等待时间。",
    },
  },
  harness: {
    hookTimeoutMs: {
      name: "Harness钩子超时",
      description: "Harness钩子超时的最长等待时间。",
    },
    manifestDebounceMs: {
      name: "Harness清单防抖",
      description: "Harness清单防抖使用的执行间隔。",
    },
    manifestCacheMaxAgeMs: {
      name: "Harness清单缓存最大时长",
      description: "Harness清单缓存最大时长使用的保留期限。",
    },
    manifestCleanupIntervalMs: {
      name: "Harness清单清理间隔",
      description: "Harness清单清理间隔使用的执行间隔。",
    },
    jsonlFlushMaxTimeMs: {
      name: "HarnessJSONL刷盘最大时间",
      description: "HarnessJSONL刷盘最大时间使用的持续时长。",
    },
    jsonlRetryBaseDelayMs: {
      name: "HarnessJSONL重试基础延迟",
      description: "HarnessJSONL重试基础延迟使用的等待时长。",
    },
    jsonlRetryMaxDelayMs: {
      name: "HarnessJSONL重试最大延迟",
      description: "HarnessJSONL重试最大延迟使用的等待时长。",
    },
    flushHookTimeoutMs: {
      name: "Harness刷盘钩子超时",
      description: "Harness刷盘钩子超时的最长等待时间。",
    },
    tmpFileMaxAgeMs: {
      name: "Harness临时文件最大时长",
      description: "Harness临时文件最大时长使用的保留期限。",
    },
    tmpCleanupMinIntervalMs: {
      name: "Harness临时文件清理最小间隔",
      description: "Harness临时文件清理最小间隔使用的执行间隔。",
    },
    cleanupGraceMs: {
      name: "Harness清理宽限",
      description: "Harness清理宽限使用的等待时长。",
    },
    runWriteLockStaleMs: {
      name: "Harness运行写入锁过期",
      description: "Harness运行写入锁过期使用的持续时长。",
    },
    maxRunAgeDays: {
      name: "Harness最大运行时长天",
      description: "Harness最大运行时长天使用的持续时长。",
    },
    fsmCacheMaxAgeMs: {
      name: "Harness状态机缓存最大时长",
      description: "Harness状态机缓存最大时长使用的保留期限。",
    },
    fsmCacheCleanupIntervalMs: {
      name: "Harness状态机缓存清理间隔",
      description: "Harness状态机缓存清理间隔使用的执行间隔。",
    },
    capabilityModelTimeoutMs: {
      name: "Harness能力模型超时",
      description: "Harness能力模型超时的最长等待时间。",
    },
    capabilityModelHookGraceMs: {
      name: "Harness能力模型钩子宽限",
      description: "Harness能力模型钩子宽限使用的等待时长。",
    },
  },
  workflow: {
    timeoutMs: {
      name: "工作流超时",
      description: "工作流超时的最长等待时间。",
    },
    nodeAgentTimeoutMs: {
      name: "工作流节点智能体超时",
      description: "工作流节点智能体超时的最长等待时间。",
    },
  },
  client: {
    sessionLongPressDelayMs: {
      name: "会话长按延迟",
      description: "触屏设备上长按会话后显示操作菜单所需的持续时间。",
    },
    micDurationRefreshIntervalMs: {
      name: "客户端麦克风持续时间刷新间隔",
      description: "客户端麦克风持续时间刷新间隔使用的执行间隔。",
    },
    thinkingElapsedRefreshIntervalMs: {
      name: "客户端思考耗时刷新间隔",
      description: "客户端思考耗时刷新间隔使用的执行间隔。",
    },
    chatMessageNavigatorScrollLockMs: {
      name: "客户端聊天消息导航滚动锁",
      description: "客户端聊天消息导航滚动锁使用的持续时长。",
    },
    wsReconnectTimeoutMs: {
      name: "客户端WebSocket重连超时",
      description: "客户端WebSocket重连超时的最长等待时间。",
    },
    sessionLogReconnectBaseDelayMs: {
      name: "客户端会话日志重连基础延迟",
      description: "客户端会话日志重连基础延迟使用的等待时长。",
    },
    sessionLogReconnectMaxDelayMs: {
      name: "客户端会话日志重连最大延迟",
      description: "客户端会话日志重连最大延迟使用的等待时长。",
    },
    sessionLogDebugTtlMs: {
      name: "客户端会话日志调试有效期",
      description: "客户端会话日志调试有效期使用的保留期限。",
    },
    monotonicActionStopTimeoutMs: {
      name: "客户端单调动作停止超时",
      description: "客户端单调动作停止超时的最长等待时间。",
    },
    monotonicActionStopPollIntervalMs: {
      name: "客户端单调动作停止轮询间隔",
      description: "客户端单调动作停止轮询间隔使用的执行间隔。",
    },
    panelResizeThrottleMs: {
      name: "客户端面板调整尺寸节流",
      description: "客户端面板调整尺寸节流使用的执行间隔。",
    },
    thinkingDetailRetryDelayMs: {
      name: "客户端思考详情重试延迟",
      description: "客户端思考详情重试延迟使用的等待时长。",
    },
    micMaxDurationSeconds: {
      name: "客户端麦克风最大持续时间秒",
      description: "客户端麦克风最大持续时间秒使用的持续时长。",
    },
    terminalTurnRetentionMs: {
      name: "客户端终态轮次保留时长",
      description: "客户端保留已结束轮次运行状态的时长。",
    },
    admissionRetryMinDelayMs: {
      name: "客户端准入重试最小延迟",
      description: "客户端准入重试最小延迟使用的等待时长。",
    },
    admissionRetryMaxDelayMs: {
      name: "客户端准入重试最大延迟",
      description: "客户端准入重试最大延迟使用的等待时长。",
    },
  },
  service: {
    httpAdmissionWindowMs: {
      name: "HTTP 准入窗口时长",
      description: "HTTP 准入窗口时长使用的统计或状态跟踪窗口时长。",
    },
    apiKeyTtlMs: {
      name: "服务API密钥有效期",
      description: "服务API密钥有效期使用的保留期限。",
    },
    orphanedTurnRecoveryGraceMs: {
      name: "服务孤立轮次恢复宽限",
      description: "服务孤立轮次恢复宽限使用的等待时长。",
    },
    userInteractionTimeoutMs: {
      name: "服务用户交互超时",
      description: "服务用户交互超时的最长等待时间。",
    },
    sessionLogMinIntervalMs: {
      name: "服务会话日志最小间隔",
      description: "服务会话日志最小间隔使用的执行间隔。",
    },
    startupProgressIntervalMs: {
      name: "服务启动进度间隔",
      description: "服务启动进度间隔使用的执行间隔。",
    },
    startupHeartbeatIntervalMs: {
      name: "服务启动心跳间隔",
      description: "服务启动心跳间隔使用的执行间隔。",
    },
    startupUnresponsiveTimeoutMs: {
      name: "服务启动无响应超时",
      description: "服务启动无响应超时的最长等待时间。",
    },
    startupStallTimeoutMs: {
      name: "服务启动停滞超时",
      description: "服务启动停滞超时的最长等待时间。",
    },
  },
  cli: {
    healthProbeMs: {
      name: "命令行健康检查探测",
      description: "命令行健康检查探测的最长等待时间。",
    },
  },
};
