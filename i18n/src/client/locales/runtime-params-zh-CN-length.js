/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  runtimeEvents: {
    maxFileBytes: {
      name: "运行事件文件大小上限",
      description: "单个运行事件文件触发轮转的大小；设为 0 关闭按大小轮转。",
    },
  },
  modelProxy: {
    logFileBytes: {
      name: "模型代理日志文件",
      description: "模型代理日志文件使用的长度或容量阈值。",
    },
  },
  diagnostics: {
    responseBytes: {
      name: "诊断响应",
      description: "诊断响应使用的长度或容量阈值。",
    },
  },
  userTemplate: {
    limitedContentChars: {
      name: "用户模板受限内容",
      description: "用户模板受限内容使用的长度或容量阈值。",
    },
  },
  connectorSecrets: {
    keyBytes: {
      name: "连接器加密密钥长度",
      description: "加密算法规定的密钥长度，属于固定约束。",
    },
    initializationVectorBytes: {
      name: "连接器加密初始化向量长度",
      description: "加密算法规定的初始化向量长度，属于固定约束。",
    },
    saltBytes: {
      name: "连接器加密盐长度",
      description: "密钥派生规定的盐长度，属于固定约束。",
    },
  },
  context: {
    phaseSummaryMessageChars: {
      name: "上下文阶段摘要消息",
      description: "上下文阶段摘要消息使用的长度或容量阈值。",
    },
    harnessSummaryMessageChars: {
      name: "上下文Harness摘要消息",
      description: "上下文Harness摘要消息使用的长度或容量阈值。",
    },
  },
  semanticTransfer: {
    directChars: {
      name: "语义转移直接传递长度上限",
      description: "决定内容可直接传递还是需要通过文件传递的长度阈值。",
    },
    toolResultInlineChars: {
      name: "工具结果内联长度上限",
      description: "工具结果可以内联传递的文本长度阈值。",
    },
    toolInputOverflowChars: {
      name: "工具输入溢出长度阈值",
      description: "工具输入进入溢出处理流程的文本长度阈值。",
    },
    previewChars: {
      name: "语义转移预览",
      description: "语义转移预览使用的长度或容量阈值。",
    },
  },
  memory: {
    longPromptPayloadChars: {
      name: "记忆长期提示词载荷",
      description: "记忆长期提示词载荷使用的长度或容量阈值。",
    },
    fileSplitChars: {
      name: "记忆文件分割",
      description: "记忆文件分割使用的长度或容量阈值。",
    },
    parserCandidatePreviewChars: {
      name: "记忆解析器候选预览",
      description: "记忆解析器候选预览使用的长度或容量阈值。",
    },
    parserRawPreviewChars: {
      name: "记忆解析器原始预览",
      description: "记忆解析器原始预览使用的长度或容量阈值。",
    },
  },
  attachments: {
    maxFileSizeBytes: {
      name: "单个附件大小上限",
      description: "单个附件允许的最大大小，不得超过附件总大小上限。",
    },
    maxTotalSizeBytes: {
      name: "附件总大小上限",
      description: "同一批附件允许的总大小上限。",
    },
  },
  clientPreview: {
    nonImageMaxBytes: {
      name: "客户端预览非图片最大",
      description: "客户端预览非图片最大使用的长度或容量阈值。",
    },
    chatMessageNavChars: {
      name: "客户端预览聊天消息导航",
      description: "客户端预览聊天消息导航使用的长度或容量阈值。",
    },
  },
  desktopLogging: {
    maxFileBytes: {
      name: "桌面端日志最大文件",
      description: "桌面端日志最大文件使用的长度或容量阈值。",
    },
  },
  serviceHttp: {
    jsonBodyBytes: {
      name: "服务HTTPJSON正文",
      description: "服务HTTPJSON正文使用的长度或容量阈值。",
    },
    workspaceFileBytes: {
      name: "服务HTTP工作区文件",
      description: "服务HTTP工作区文件使用的长度或容量阈值。",
    },
    workspaceAssetFileBytes: {
      name: "服务HTTP工作区资源文件",
      description: "服务HTTP工作区资源文件使用的长度或容量阈值。",
    },
  },
  installers: {
    versionOutputBytes: {
      name: "OpenVSCode 版本输出上限",
      description: "安装器读取 OpenVSCode Server 版本命令输出时允许的最大字节数。",
    },
    openVscodeArchiveBytes: {
      name: "OpenVSCode 安装包大小上限",
      description: "安装器允许下载的 OpenVSCode Server 安装包最大字节数。",
    },
  },
  toolIO: {
    connectorCommandFileBytes: {
      name: "工具IO连接器命令文件",
      description: "工具IO连接器命令文件使用的长度或容量阈值。",
    },
    cleanedTextChars: {
      name: "工具IO清理后文本",
      description: "工具IO清理后文本使用的长度或容量阈值。",
    },
    runtimeCleanAnyChars: {
      name: "工具IO运行时清理任意",
      description: "工具IO运行时清理任意使用的长度或容量阈值。",
    },
    webMinTagTextChars: {
      name: "工具IO网页最小标签文本",
      description: "工具IO网页最小标签文本使用的长度或容量阈值。",
    },
  },
  nativeScript: {
    resultBytes: {
      name: "原生脚本结果",
      description: "原生脚本结果使用的长度或容量阈值。",
    },
    sourceBytes: {
      name: "原生脚本源码大小上限",
      description: "原生脚本执行请求允许的源码大小上限。",
    },
    textReadBytes: {
      name: "原生脚本文本读取",
      description: "原生脚本文本读取使用的长度或容量阈值。",
    },
    binaryReadBytes: {
      name: "原生脚本二进制读取",
      description: "原生脚本二进制读取使用的长度或容量阈值。",
    },
    processOutputBytes: {
      name: "原生脚本进程输出",
      description: "原生脚本进程输出使用的长度或容量阈值。",
    },
    inputTotalBytes: {
      name: "原生脚本输入总计",
      description: "原生脚本输入总计使用的长度或容量阈值。",
    },
    artifactTotalBytes: {
      name: "原生脚本产物总计",
      description: "原生脚本产物总计使用的长度或容量阈值。",
    },
  },
  dataProcessing: {
    responsesFileInputBytes: {
      name: "数据处理Responses文件输入",
      description: "数据处理Responses文件输入使用的长度或容量阈值。",
    },
  },
  harness: {
    jsonlFileBytes: {
      name: "HarnessJSONL文件",
      description: "HarnessJSONL文件使用的长度或容量阈值。",
    },
    jsonlMaxBufferBytes: {
      name: "HarnessJSONL最大缓冲区",
      description: "HarnessJSONL最大缓冲区使用的长度或容量阈值。",
    },
    relayInjectionMaxChars: {
      name: "Harness中继注入最大",
      description: "Harness中继注入最大使用的长度或容量阈值。",
    },
  },
  pluginMessage: {
    payloadBytes: {
      name: "插件消息载荷",
      description: "插件消息载荷使用的长度或容量阈值。",
    },
  },
  sessionLog: {
    maxDebugQueueBytes: {
      name: "会话日志最大调试队列",
      description: "会话日志最大调试队列使用的长度或容量阈值。",
    },
    messageChars: {
      name: "会话日志消息",
      description: "会话日志消息使用的长度或容量阈值。",
    },
    identityChars: {
      name: "会话日志身份",
      description: "会话日志身份的固定约束，不支持运行时修改。",
    },
    levelChars: {
      name: "会话日志级别",
      description: "会话日志级别的固定约束，不支持运行时修改。",
    },
    sourceChars: {
      name: "会话日志来源",
      description: "会话日志来源使用的长度或容量阈值。",
    },
    maxPayloadBytes: {
      name: "会话日志最大载荷",
      description: "会话日志最大载荷使用的长度或容量阈值。",
    },
  },
  agentProxy: {
    maxBodyBytes: {
      name: "智能体代理请求正文大小上限",
      description: "智能体代理允许接收的 HTTP 请求正文大小上限。",
    },
    webSocketMaxPayloadBytes: {
      name: "智能体代理WebSocket最大载荷",
      description: "智能体代理WebSocket最大载荷使用的长度或容量阈值。",
    },
    webSocketMaxBufferedBytes: {
      name: "智能体代理WebSocket最大已缓冲",
      description: "智能体代理WebSocket最大已缓冲使用的长度或容量阈值。",
    },
  },
  artifact: {
    executionEventSegmentBytes: {
      name: "产物执行事件分段",
      description: "产物执行事件分段使用的长度或容量阈值。",
    },
    turnMaterializerCacheBytes: {
      name: "产物轮次物化缓存",
      description: "产物轮次物化缓存使用的长度或容量阈值。",
    },
    verifiedSnapshotCacheBytes: {
      name: "产物已验证快照缓存",
      description: "产物已验证快照缓存使用的长度或容量阈值。",
    },
    verifiedCheckpointIdentityCacheBytes: {
      name: "产物已验证检查点身份缓存",
      description: "产物已验证检查点身份缓存使用的长度或容量阈值。",
    },
  },
  display: {
    toolOperationSubjectChars: {
      name: "展示工具操作主题",
      description: "展示工具操作主题使用的长度或容量阈值。",
    },
    modelContextContentChars: {
      name: "展示模型上下文内容",
      description: "展示模型上下文内容使用的长度或容量阈值。",
    },
    hookProgressTextChars: {
      name: "展示钩子进度文本",
      description: "展示钩子进度文本使用的长度或容量阈值。",
    },
    attachmentExtensionChars: {
      name: "展示附件扩展",
      description: "展示附件扩展使用的长度或容量阈值。",
    },
    planningRawOutputPreviewChars: {
      name: "展示规划原始输出预览",
      description: "展示规划原始输出预览使用的长度或容量阈值。",
    },
    toolResultTraceChars: {
      name: "展示工具结果跟踪",
      description: "展示工具结果跟踪使用的长度或容量阈值。",
    },
    mcpTaskResultPreviewChars: {
      name: "展示MCP任务结果预览",
      description: "展示MCP任务结果预览使用的长度或容量阈值。",
    },
    harnessPreviewChars: {
      name: "展示Harness预览",
      description: "展示Harness预览使用的长度或容量阈值。",
    },
    sessionSummaryArrayItemChars: {
      name: "展示会话摘要数组条目",
      description: "展示会话摘要数组条目使用的长度或容量阈值。",
    },
  },
  contextPreview: {
    planningCompactTextChars: {
      name: "上下文预览规划压缩文本",
      description: "上下文预览规划压缩文本使用的长度或容量阈值。",
    },
    planningContextGoalChars: {
      name: "上下文预览规划上下文目标",
      description: "上下文预览规划上下文目标使用的长度或容量阈值。",
    },
    workflowCompactTextChars: {
      name: "上下文预览工作流压缩文本",
      description: "上下文预览工作流压缩文本使用的长度或容量阈值。",
    },
    workflowResultTextChars: {
      name: "上下文预览工作流结果文本",
      description: "上下文预览工作流结果文本使用的长度或容量阈值。",
    },
    workflowSemanticTextPreviewChars: {
      name: "上下文预览工作流语义文本预览",
      description: "上下文预览工作流语义文本预览使用的长度或容量阈值。",
    },
    harnessDynamicPolicyPromptChars: {
      name: "上下文预览Harness动态策略提示词",
      description: "上下文预览Harness动态策略提示词使用的长度或容量阈值。",
    },
  },
};
