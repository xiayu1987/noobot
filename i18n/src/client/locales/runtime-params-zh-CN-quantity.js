/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  runtimeEvents: {
    maxArchives: {
      name: "运行事件归档保留数量",
      description: "按数量保留的运行事件归档上限；设为 0 关闭按数量清理。",
    },
    maxCachedFiles: {
      name: "运行时事件最大缓存文件",
      description: "运行时事件最大缓存文件使用的数量阈值。",
    },
    batchMaxRecords: {
      name: "运行时事件批次最大记录",
      description: "运行时事件批次最大记录使用的数量阈值。",
    },
  },
  connectorInstances: {
    mysqlPoolLimit: {
      name: "连接器实例MySQL连接池上限",
      description: "连接器实例MySQL连接池上限使用的数量阈值。",
    },
    postgresPoolMax: {
      name: "连接器实例PostgreSQL连接池最大",
      description: "连接器实例PostgreSQL连接池最大使用的数量阈值。",
    },
  },
  eventProtocol: {
    authorityOutboxPendingBatchSize: {
      name: "事件协议权威状态发件箱待处理批次大小",
      description: "事件协议权威状态发件箱待处理批次大小使用的数量阈值。",
    },
  },
  longMemory: {
    workAssistantCollaborationMaxItems: {
      name: "长期记忆工作助手协作最大条目",
      description: "长期记忆工作助手协作最大条目使用的数量阈值。",
    },
    workQualityStandardsMaxItems: {
      name: "长期记忆工作质量标准最大条目",
      description: "长期记忆工作质量标准最大条目使用的数量阈值。",
    },
    workWorkStyleMaxItems: {
      name: "长期记忆工作风格最大条目",
      description: "长期记忆工作风格最大条目使用的数量阈值。",
    },
    workToolsMethodsMaxItems: {
      name: "长期记忆工作工具方法最大条目",
      description: "长期记忆工作工具方法最大条目使用的数量阈值。",
    },
    workLongTermProjectsMaxItems: {
      name: "长期记忆工作长期项目最大条目",
      description: "长期记忆工作长期项目最大条目使用的数量阈值。",
    },
    historyPreferencesCommonTopicsMaxItems: {
      name: "长期记忆历史偏好常见话题最大条目",
      description: "长期记忆历史偏好常见话题最大条目使用的数量阈值。",
    },
    socialImportantRelationshipsMaxItems: {
      name: "长期记忆社交重要关系最大条目",
      description: "长期记忆社交重要关系最大条目使用的数量阈值。",
    },
    personalityEmotionalTendenciesMaxItems: {
      name: "长期记忆个性情绪倾向最大条目",
      description: "长期记忆个性情绪倾向最大条目使用的数量阈值。",
    },
    personalityTraitsMaxItems: {
      name: "长期记忆个性特征最大条目",
      description: "长期记忆个性特征最大条目使用的数量阈值。",
    },
    interestsPreferredActivitiesMaxItems: {
      name: "长期记忆兴趣偏好活动最大条目",
      description: "长期记忆兴趣偏好活动最大条目使用的数量阈值。",
    },
    interestsFavoriteMusicMaxItems: {
      name: "长期记忆兴趣喜爱音乐最大条目",
      description: "长期记忆兴趣喜爱音乐最大条目使用的数量阈值。",
    },
    interestsFavoriteMoviesMaxItems: {
      name: "长期记忆兴趣喜爱电影最大条目",
      description: "长期记忆兴趣喜爱电影最大条目使用的数量阈值。",
    },
    interestsFavoriteBooksMaxItems: {
      name: "长期记忆兴趣喜爱书籍最大条目",
      description: "长期记忆兴趣喜爱书籍最大条目使用的数量阈值。",
    },
    interestsHobbiesMaxItems: {
      name: "长期记忆兴趣爱好最大条目",
      description: "长期记忆兴趣爱好最大条目使用的数量阈值。",
    },
  },
  contextProtocol: {
    turnSummaryCheckpointReceiptLimit: {
      name: "上下文协议轮次摘要检查点回执上限",
      description: "上下文协议轮次摘要检查点回执上限使用的数量阈值。",
    },
  },
  memory: {
    maxItems: {
      name: "记忆条目上限",
      description: "记忆处理时允许保留的条目数量上限。",
    },
  },
  attachments: {
    maxFileCount: {
      name: "附件最大文件数量",
      description: "附件最大文件数量使用的数量阈值。",
    },
  },
  toolIO: {
    readMaxLines: {
      name: "文件读取默认行数上限",
      description: "未指定读取行数时使用的默认上限，不得超过读取行数硬上限。",
    },
    readMaxLinesLimit: {
      name: "文件读取行数硬上限",
      description: "文件读取请求允许指定的最大行数。",
    },
    searchMaxResults: {
      name: "搜索默认结果上限",
      description: "未指定搜索结果数量时使用的默认上限。",
    },
    searchMaxResultsLimit: {
      name: "搜索结果数量硬上限",
      description: "搜索请求允许指定的最大结果数量。",
    },
    searchContextLines: {
      name: "搜索默认上下文行数",
      description: "每处搜索命中默认显示的前后文行数；0 表示不显示上下文。",
    },
    searchContextLinesLimit: {
      name: "搜索上下文行数硬上限",
      description: "搜索请求允许指定的最大前后文行数。",
    },
    patchFailureContextRadius: {
      name: "工具IO补丁失败上下文半径",
      description: "工具IO补丁失败上下文半径使用的数量阈值。",
    },
  },
  diagnostics: {
    modelContextPreviewLimit: {
      name: "诊断模型上下文预览上限",
      description: "诊断模型上下文预览上限使用的数量阈值。",
    },
    executionReportSlowestToolCalls: {
      name: "诊断执行报告最慢工具调用",
      description: "诊断执行报告最慢工具调用使用的数量阈值。",
    },
  },
  web: {
    maxRedirects: {
      name: "网页最大重定向",
      description: "网页最大重定向使用的数量阈值。",
    },
    readableExtractMaxLines: {
      name: "网页可读提取最大行数",
      description: "网页可读提取最大行数使用的数量阈值。",
    },
    textMaxLines: {
      name: "网页文本最大行数",
      description: "网页文本最大行数使用的数量阈值。",
    },
  },
  desktop: {
    logRetainCount: {
      name: "桌面端日志保留数量",
      description: "桌面端日志保留数量使用的数量阈值。",
    },
  },
  harness: {
    jsonlFlushMaxSize: {
      name: "HarnessJSONL刷盘最大大小",
      description: "HarnessJSONL刷盘最大大小使用的数量阈值。",
    },
    jsonlMaxBufferEntries: {
      name: "HarnessJSONL最大缓冲区条目",
      description: "HarnessJSONL最大缓冲区条目使用的数量阈值。",
    },
    jsonlMaxFiles: {
      name: "HarnessJSONL最大文件",
      description: "HarnessJSONL最大文件使用的数量阈值。",
    },
    maxRuns: {
      name: "Harness最大运行",
      description: "Harness最大运行使用的数量阈值。",
    },
    completedDialogIds: {
      name: "Harness已完成对话标识",
      description: "Harness已完成对话标识使用的数量阈值。",
    },
    incrementalMessageCacheEntries: {
      name: "Harness增量消息缓存条目",
      description: "Harness增量消息缓存条目使用的数量阈值。",
    },
  },
  client: {
    resendDebugLimit: {
      name: "客户端重发调试上限",
      description: "客户端重发调试上限使用的数量阈值。",
    },
    toolLogDebugLimit: {
      name: "客户端工具日志调试上限",
      description: "客户端工具日志调试上限使用的数量阈值。",
    },
    consumedEventIdsLimit: {
      name: "客户端已消费事件标识上限",
      description: "客户端已消费事件标识上限使用的数量阈值。",
    },
    executionLogDisplayLimit: {
      name: "客户端执行日志展示上限",
      description: "客户端执行日志展示上限使用的数量阈值。",
    },
    messageAnchorScrollOffsetPx: {
      name: "客户端消息锚点滚动偏移",
      description: "客户端消息锚点滚动偏移的固定约束，不支持运行时修改。",
    },
    messageAnchorCurrentThresholdPx: {
      name: "客户端消息锚点当前阈值",
      description: "客户端消息锚点当前阈值的固定约束，不支持运行时修改。",
    },
    messageListEstimatedRowHeightPx: {
      name: "客户端消息列表估计行高度",
      description: "客户端消息列表估计行高度的固定约束，不支持运行时修改。",
    },
    messageListInitialViewportHeightPx: {
      name: "客户端消息列表初始视口高度",
      description: "客户端消息列表初始视口高度的固定约束，不支持运行时修改。",
    },
    messageListVirtualOverscan: {
      name: "客户端消息列表虚拟预渲染",
      description: "客户端消息列表虚拟预渲染使用的数量阈值。",
    },
    thinkingDetailEstimatedRowHeightPx: {
      name: "客户端思考详情估计行高度",
      description: "客户端思考详情估计行高度的固定约束，不支持运行时修改。",
    },
    thinkingDetailInitialViewportHeightPx: {
      name: "客户端思考详情初始视口高度",
      description: "客户端思考详情初始视口高度的固定约束，不支持运行时修改。",
    },
    thinkingDetailVirtualOverscan: {
      name: "客户端思考详情虚拟预渲染",
      description: "客户端思考详情虚拟预渲染使用的数量阈值。",
    },
    thinkingDetailRetryLimit: {
      name: "客户端思考详情重试上限",
      description: "客户端思考详情重试上限使用的数量阈值。",
    },
    frameHealthTopScriptLimit: {
      name: "客户端帧健康检查排行脚本上限",
      description: "客户端帧健康检查排行脚本上限使用的数量阈值。",
    },
    sessionListRecentDayGroupCount: {
      name: "客户端会话列表最近日分组数量",
      description: "客户端会话列表最近日分组数量使用的数量阈值。",
    },
  },
  sessionLog: {
    maxBatchSize: {
      name: "会话日志最大批次大小",
      description: "会话日志最大批次大小使用的数量阈值。",
    },
    maxQueueSize: {
      name: "会话日志最大队列大小",
      description: "会话日志最大队列大小使用的数量阈值。",
    },
    maxDebugQueueSize: {
      name: "会话日志最大调试队列大小",
      description: "会话日志最大调试队列大小使用的数量阈值。",
    },
  },
  agentProxy: {
    fixedWindowMaxRequests: {
      name: "智能体代理固定窗口最大请求",
      description: "智能体代理固定窗口最大请求使用的数量阈值。",
    },
    maxChannelEvents: {
      name: "通道事件缓存条数上限",
      description: "每个代理通道允许保留的事件数量上限。",
    },
    maxConnections: {
      name: "智能体代理连接数上限",
      description: "智能体代理允许同时保留的连接数量上限。",
    },
    httpRateLimitMaxRequests: {
      name: "智能体代理HTTP速率上限最大请求",
      description: "智能体代理HTTP速率上限最大请求使用的数量阈值。",
    },
    wsRateLimitMaxUpgrades: {
      name: "智能体代理WebSocket速率上限最大升级",
      description: "智能体代理WebSocket速率上限最大升级使用的数量阈值。",
    },
    ideWsRateLimitMaxUpgrades: {
      name: "智能体代理IDEWebSocket速率上限最大升级",
      description: "智能体代理IDEWebSocket速率上限最大升级使用的数量阈值。",
    },
    ideHttpRateLimitMaxRequests: {
      name: "智能体代理IDEHTTP速率上限最大请求",
      description: "智能体代理IDEHTTP速率上限最大请求使用的数量阈值。",
    },
    maxReplayEvents: {
      name: "事件重放数量上限",
      description: "代理重放流程允许处理的事件数量上限。",
    },
    invalidUpstreamFrameLimit: {
      name: "智能体代理无效上游帧上限",
      description: "智能体代理无效上游帧上限使用的数量阈值。",
    },
    commandRemovalHistoryLimit: {
      name: "智能体代理命令移除历史上限",
      description: "智能体代理命令移除历史上限使用的数量阈值。",
    },
  },
  service: {
    httpConnectionLimit: {
      name: "连接请求窗口上限",
      description: "连接请求窗口上限使用的数量阈值。",
    },
    httpMutationLimit: {
      name: "修改请求窗口上限",
      description: "修改请求窗口上限使用的数量阈值。",
    },
    httpReadLimit: {
      name: "读取请求窗口上限",
      description: "读取请求窗口上限使用的数量阈值。",
    },
  },
};
