/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default {
  modelRuntime: {
    anthropicPauseTurnMaxContinuations: {
      name: "Model runtime Anthropic pause turn max continuations",
      description:
        "Turn or attempt count threshold used by model runtime anthropic pause turn max continuations.",
    },
  },
  agent: {
    maxToolLoopTurns: {
      name: "Agent tool loop turn limit",
      description: "Maximum tool loop turns allowed in a single agent run.",
    },
    toolLoopLimitBufferTurns: {
      name: "Tool loop limit buffer turns",
      description: "Turn buffer reserved near the tool loop limit.",
    },
    phaseSummaryLoopTurns: {
      name: "Agent phase summary loop turns",
      description: "Turn or attempt count threshold used by agent phase summary loop turns.",
    },
    taskCheckLoopTurns: {
      name: "Agent task check loop turns",
      description: "Turn or attempt count threshold used by agent task check loop turns.",
    },
    helpPromptLoopTurns: {
      name: "Agent help prompt loop turns",
      description: "Turn or attempt count threshold used by agent help prompt loop turns.",
    },
    toolFailureHelpCount: {
      name: "Tool failure help threshold",
      description: "Tool failure count that triggers a help prompt.",
    },
  },
  session: {
    mainModelHistoryRoundLimit: {
      name: "Session main model history round limit",
      description:
        "Turn or attempt count threshold used by session main model history round limit.",
    },
  },
  subTasks: {
    processContentTaskMaxToolLoopTurns: {
      name: "Sub tasks process content task max tool loop turns",
      description:
        "Turn or attempt count threshold used by sub tasks process content task max tool loop turns.",
    },
    processConnectorToolMaxToolLoopTurns: {
      name: "Sub tasks process connector tool max tool loop turns",
      description:
        "Turn or attempt count threshold used by sub tasks process connector tool max tool loop turns.",
    },
    callMcpTaskMaxToolLoopTurns: {
      name: "Sub tasks call MCP task max tool loop turns",
      description:
        "Turn or attempt count threshold used by sub tasks call mcp task max tool loop turns.",
    },
    mcpTaskMaxTurns: {
      name: "Sub tasks MCP task max turns",
      description: "Turn or attempt count threshold used by sub tasks mcp task max turns.",
    },
  },
  capability: {
    miniRunnerMaxToolTurns: {
      name: "Capability mini runner max tool turns",
      description: "Turn or attempt count threshold used by capability mini runner max tool turns.",
    },
  },
  tools: {
    nativeTaskCleanupMaxRetries: {
      name: "Tools native task cleanup max retries",
      description: "Turn or attempt count threshold used by tools native task cleanup max retries.",
    },
    browserDevtoolsPortReadAttempts: {
      name: "Tools browser devtools port read attempts",
      description:
        "Turn or attempt count threshold used by tools browser devtools port read attempts.",
    },
  },
  harness: {
    miniRunnerMaxTurns: {
      name: "Harness mini runner max turns",
      description: "Turn or attempt count threshold used by harness mini runner max turns.",
    },
    pendingTtlHookTurns: {
      name: "Harness pending TTL hook turns",
      description: "Turn or attempt count threshold used by harness pending ttl hook turns.",
    },
    pendingWarnCooldownTurns: {
      name: "Harness pending warn cooldown turns",
      description: "Turn or attempt count threshold used by harness pending warn cooldown turns.",
    },
    modeThresholds: {
      full: {
        summaryTurns: {
          name: "Harness mode thresholds full summary turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds full summary turns.",
        },
        analysisTurns: {
          name: "Harness mode thresholds full analysis turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds full analysis turns.",
        },
        planUpdateTriggerTurns: {
          name: "Harness mode thresholds full plan update trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds full plan update trigger turns.",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness mode thresholds full phase acceptance trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds full phase acceptance trigger turns.",
        },
      },
      programming: {
        summaryTurns: {
          name: "Harness mode thresholds programming summary turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds programming summary turns.",
        },
        analysisTurns: {
          name: "Harness mode thresholds programming analysis turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds programming analysis turns.",
        },
        planUpdateTriggerTurns: {
          name: "Harness mode thresholds programming plan update trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds programming plan update trigger turns.",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness mode thresholds programming phase acceptance trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds programming phase acceptance trigger turns.",
        },
      },
      text: {
        summaryTurns: {
          name: "Harness mode thresholds text summary turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds text summary turns.",
        },
        analysisTurns: {
          name: "Harness mode thresholds text analysis turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds text analysis turns.",
        },
        planUpdateTriggerTurns: {
          name: "Harness mode thresholds text plan update trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds text plan update trigger turns.",
        },
        phaseAcceptanceTriggerTurns: {
          name: "Harness mode thresholds text phase acceptance trigger turns",
          description:
            "Turn or attempt count threshold used by harness mode thresholds text phase acceptance trigger turns.",
        },
      },
    },
    planning: {
      planUpdateRevisionMaxAttempts: {
        name: "Harness planning plan update revision max attempts",
        description:
          "Turn or attempt count threshold used by harness planning plan update revision max attempts.",
      },
      planUpdateRefinementMaxAttempts: {
        name: "Harness planning plan update refinement max attempts",
        description:
          "Turn or attempt count threshold used by harness planning plan update refinement max attempts.",
      },
      captureMaxAttempts: {
        name: "Harness planning capture max attempts",
        description:
          "Turn or attempt count threshold used by harness planning capture max attempts.",
      },
    },
    jsonl: {
      flushMaxRetry: {
        name: "Harness JSONL flush max retry",
        description: "Turn or attempt count threshold used by harness jsonl flush max retry.",
      },
    },
    guidance: {
      failureConsecutive: {
        name: "Harness consecutive failure threshold",
        description: "Consecutive failure count that triggers guidance analysis.",
      },
      failureAccumulated: {
        name: "Harness accumulated failure threshold",
        description: "Accumulated failure count that triggers guidance analysis.",
      },
    },
  },
  workflow: {
    miniRunnerMaxTurns: {
      name: "Workflow mini runner max turns",
      description: "Turn or attempt count threshold used by workflow mini runner max turns.",
    },
  },
  transport: {
    turnLifecycleDeliveryMaxAttempts: {
      name: "Transport turn lifecycle delivery max attempts",
      description:
        "Turn or attempt count threshold used by transport turn lifecycle delivery max attempts.",
    },
  },
  client: {
    admissionMaxRetries: {
      name: "Client admission max retries",
      description: "Turn or attempt count threshold used by client admission max retries.",
    },
  },
  model: {
    maxTotalAttempts: {
      name: "Model invocation attempt limit",
      description:
        "Shared attempt budget for transport, mode negotiation and semantic recovery, including the initial request.",
    },
    transportMaxAttempts: {
      name: "Model transport attempt limit",
      description:
        "Total attempts allowed for model transport failures, including the initial request.",
    },
    generationMaxAttempts: {
      name: "Model media generation attempt limit",
      description:
        "Total attempts allowed for image or video generation, including the initial request.",
    },
    reasoningOnlyMaxAttempts: {
      name: "Reasoning-only maximum attempts",
      description: "Turn or attempt count threshold used by reasoning-only maximum attempts.",
    },
    emptyResponseMaxAttempts: {
      name: "Empty response maximum attempts",
      description: "Turn or attempt count threshold used by empty response maximum attempts.",
    },
    toolCallMismatchMaxAttempts: {
      name: "Tool call mismatch maximum attempts",
      description: "Turn or attempt count threshold used by tool call mismatch maximum attempts.",
    },
    diagnosticMaxAttempts: {
      name: "Model diagnostic request attempts",
      description:
        "Fixed constraint for model diagnostic request attempts; not editable at runtime.",
    },
  },
};
