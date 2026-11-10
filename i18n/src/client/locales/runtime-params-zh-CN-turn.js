/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  modelRuntime: {
    anthropicPauseTurnMaxContinuations: {
      name: "模型运行时Anthropic暂停轮次最大续接",
      description: "模型运行时Anthropic暂停轮次最大续接使用的轮次或尝试次数阈值。",
    },
  },
  agent: {
    maxToolLoopTurns: {
      name: "智能体工具循环轮次上限",
      description: "单次智能体运行允许的工具循环轮次上限。",
    },
    toolLoopLimitBufferTurns: {
      name: "工具循环上限缓冲轮次",
      description: "接近工具循环轮次上限时保留的缓冲轮次。",
    },
    phaseSummaryLoopTurns: {
      name: "智能体阶段摘要循环轮次",
      description: "智能体阶段摘要循环轮次使用的轮次或尝试次数阈值。",
    },
    taskCheckLoopTurns: {
      name: "智能体任务检查循环轮次",
      description: "智能体任务检查循环轮次使用的轮次或尝试次数阈值。",
    },
    helpPromptLoopTurns: {
      name: "智能体帮助提示词循环轮次",
      description: "智能体帮助提示词循环轮次使用的轮次或尝试次数阈值。",
    },
    toolFailureHelpCount: {
      name: "工具失败帮助触发次数",
      description: "工具失败达到此次数时触发帮助提示。",
    },
  },
  session: {
    mainModelHistoryRoundLimit: {
      name: "会话主模型历史轮次上限",
      description: "会话主模型历史轮次上限使用的轮次或尝试次数阈值。",
    },
  },
  subTasks: {
    processContentTaskMaxToolLoopTurns: {
      name: "子任务处理内容任务最大工具循环轮次",
      description: "子任务处理内容任务最大工具循环轮次使用的轮次或尝试次数阈值。",
    },
    processConnectorToolMaxToolLoopTurns: {
      name: "子任务处理连接器工具最大工具循环轮次",
      description: "子任务处理连接器工具最大工具循环轮次使用的轮次或尝试次数阈值。",
    },
    callMcpTaskMaxToolLoopTurns: {
      name: "子任务调用MCP任务最大工具循环轮次",
      description: "子任务调用MCP任务最大工具循环轮次使用的轮次或尝试次数阈值。",
    },
    mcpTaskMaxTurns: {
      name: "子任务MCP任务最大轮次",
      description: "子任务MCP任务最大轮次使用的轮次或尝试次数阈值。",
    },
  },
  capability: {
    miniRunnerMaxToolTurns: {
      name: "能力轻量执行器最大工具轮次",
      description: "能力轻量执行器最大工具轮次使用的轮次或尝试次数阈值。",
    },
  },
  tools: {
    nativeTaskCleanupMaxRetries: {
      name: "工具原生任务清理最大重试",
      description: "工具原生任务清理最大重试使用的轮次或尝试次数阈值。",
    },
    browserDevtoolsPortReadAttempts: {
      name: "工具浏览器开发工具端口读取尝试",
      description: "工具浏览器开发工具端口读取尝试使用的轮次或尝试次数阈值。",
    },
  },
  harness: {
    miniRunnerMaxTurns: {
      name: "Harness轻量执行器最大轮次",
      description: "Harness轻量执行器最大轮次使用的轮次或尝试次数阈值。",
    },
    pendingTtlHookTurns: {
      name: "Harness待处理有效期钩子轮次",
      description: "Harness待处理有效期钩子轮次使用的轮次或尝试次数阈值。",
    },
    pendingWarnCooldownTurns: {
      name: "Harness待处理警告冷却轮次",
      description: "Harness待处理警告冷却轮次使用的轮次或尝试次数阈值。",
    },
    modeThresholds: {
      full: {
        summaryTurns: {
          name: "Harness模式阈值完整摘要轮次",
          description: "Harness模式阈值完整摘要轮次使用的轮次或尝试次数阈值。",
        },
        analysisTurns: {
          name: "Harness模式阈值完整分析轮次",
          description: "Harness模式阈值完整分析轮次使用的轮次或尝试次数阈值。",
        },
        planUpdateTriggerTurns: {
          name: "Harness模式阈值完整计划更新触发轮次",
          description: "Harness模式阈值完整计划更新触发轮次使用的轮次或尝试次数阈值。",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness模式阈值完整阶段验收触发轮次",
          description: "Harness模式阈值完整阶段验收触发轮次使用的轮次或尝试次数阈值。",
        },
      },
      programming: {
        summaryTurns: {
          name: "Harness模式阈值编程摘要轮次",
          description: "Harness模式阈值编程摘要轮次使用的轮次或尝试次数阈值。",
        },
        analysisTurns: {
          name: "Harness模式阈值编程分析轮次",
          description: "Harness模式阈值编程分析轮次使用的轮次或尝试次数阈值。",
        },
        planUpdateTriggerTurns: {
          name: "Harness模式阈值编程计划更新触发轮次",
          description: "Harness模式阈值编程计划更新触发轮次使用的轮次或尝试次数阈值。",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness模式阈值编程阶段验收触发轮次",
          description: "Harness模式阈值编程阶段验收触发轮次使用的轮次或尝试次数阈值。",
        },
      },
      text: {
        summaryTurns: {
          name: "Harness模式阈值文本摘要轮次",
          description: "Harness模式阈值文本摘要轮次使用的轮次或尝试次数阈值。",
        },
        analysisTurns: {
          name: "Harness模式阈值文本分析轮次",
          description: "Harness模式阈值文本分析轮次使用的轮次或尝试次数阈值。",
        },
        planUpdateTriggerTurns: {
          name: "Harness模式阈值文本计划更新触发轮次",
          description: "Harness模式阈值文本计划更新触发轮次使用的轮次或尝试次数阈值。",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness模式阈值文本阶段验收触发轮次",
          description: "Harness模式阈值文本阶段验收触发轮次使用的轮次或尝试次数阈值。",
        },
      },
    },
    planning: {
      planUpdateRevisionMaxAttempts: {
        name: "Harness规划计划更新修订最大尝试",
        description: "Harness规划计划更新修订最大尝试使用的轮次或尝试次数阈值。",
      },
      planUpdateRefinementMaxAttempts: {
        name: "Harness规划计划更新细化最大尝试",
        description: "Harness规划计划更新细化最大尝试使用的轮次或尝试次数阈值。",
      },
      captureMaxAttempts: {
        name: "Harness规划捕获最大尝试",
        description: "Harness规划捕获最大尝试使用的轮次或尝试次数阈值。",
      },
    },
    jsonl: {
      flushMaxRetry: {
        name: "HarnessJSONL刷盘最大重试",
        description: "HarnessJSONL刷盘最大重试使用的轮次或尝试次数阈值。",
      },
    },
    guidance: {
      failureConsecutive: {
        name: "Harness 连续失败触发次数",
        description: "连续失败达到此次数时触发引导分析。",
      },
      failureAccumulated: {
        name: "Harness 累计失败触发次数",
        description: "累计失败达到此次数时触发引导分析。",
      },
    },
  },
  workflow: {
    miniRunnerMaxTurns: {
      name: "工作流轻量执行器最大轮次",
      description: "工作流轻量执行器最大轮次使用的轮次或尝试次数阈值。",
    },
  },
  transport: {
    turnLifecycleDeliveryMaxAttempts: {
      name: "传输轮次生命周期投递最大尝试",
      description: "传输轮次生命周期投递最大尝试使用的轮次或尝试次数阈值。",
    },
  },
  client: {
    admissionMaxRetries: {
      name: "客户端准入最大重试",
      description: "客户端准入最大重试使用的轮次或尝试次数阈值。",
    },
  },
  model: {
    maxTotalAttempts: {
      name: "模型调用总尝试次数上限",
      description: "传输重试、模式协商和语义恢复共用的请求预算，包含首次请求。",
    },
    transportMaxAttempts: {
      name: "模型传输尝试次数上限",
      description: "模型传输失败时允许的总尝试次数，包含首次请求。",
    },
    generationMaxAttempts: {
      name: "模型媒体生成尝试次数上限",
      description: "图片或视频生成允许的总尝试次数，包含首次请求。",
    },
    reasoningOnlyMaxAttempts: {
      name: "仅返回推理的最大尝试次数",
      description: "仅返回推理的最大尝试次数使用的轮次或尝试次数阈值。",
    },
    emptyResponseMaxAttempts: {
      name: "模型空响应最大尝试次数",
      description: "模型空响应最大尝试次数使用的轮次或尝试次数阈值。",
    },
    toolCallMismatchMaxAttempts: {
      name: "工具调用不匹配最大尝试次数",
      description: "工具调用不匹配最大尝试次数使用的轮次或尝试次数阈值。",
    },
    diagnosticMaxAttempts: {
      name: "模型诊断请求次数",
      description: "模型诊断请求次数的固定约束，不支持运行时修改。",
    },
  },
};
