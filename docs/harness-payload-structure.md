# Harness Payload 数据结构

> 本文档记录 `agentContext.payload.harness` 的当前结构与初始化规则。  
> 主文档请见：[agent-context-structure.md](./agent-context-structure.md)。

## 1. 定位与职责

- `payload.harness` 不是 `ContextBuilder` 初始输出的一部分。
- 它由 harness 插件在 hook 执行期间通过 `ensureHarnessBucket(ctx)` 按需创建/补齐。
- 用途是承载 planning/guidance/acceptance/review 的状态、日志与产物。

## 2. 结构定义

```ts
type HarnessPayloadBucket = {
  __harnessBucketVersion: number; // 当前为 3

  summaryText: string;
  planText: string;
  taskChecklist: any[];

  acceptanceReports: any[];
  phaseAcceptanceReports: any[];
  reviewReports: any[];
  planningRawOutputs: any[];
  completedDialogProcessIds: string[];

  globalRevisionCount: number;
  lastMainPlanRevisionChanged: boolean;
  lastPlanningRawOutput: Record<string, any> | null;

  logs: {
    planning: any[];
    guidance: any[];
    acceptance: any[];
    review: any[];
  };

  state: {
    __harnessBucketVersion: number;
    locale: string;

    counters: {
      llmTurns: number;
      planUpdateTurns: number;
      phaseAcceptanceTurns: number;
      summaryRounds: number;
      hookTurns: number;
      consecutiveToolFailures: number;
      totalToolFailures: number;
      planUpdateAttempts: number;
    };

    flags: {
      planningPromptInjected: boolean;
      planningCaptured: boolean;
      planningSeparateModelInFlight: boolean;
      agentTurnEnded: boolean;
      acceptanceRequested: boolean;
      checklistArtifactsAttached: boolean;
      planningForceToolTemporarilyEnabled: boolean;
      planningForceToolOriginalSet: boolean;
      planningForceToolOriginal: boolean;
      guidanceSummaryMarkPending: boolean;
      summaryByCharsPrompted: boolean;
      overflowForceAcceptancePending: boolean;
      planUpdateCapturePending: boolean;
      phaseAcceptanceCapturePending: boolean;
      acceptanceSemanticValidationCapturePending: boolean;
    };

    signals: {
      parsedAttachment: boolean;
      subtaskStarted: boolean;
      subtaskWaited: boolean;
      successfulToolCount: number;
      activeDialogProcessId: string;
    };

    pending: {
      guidance: any | null;
      summary: boolean;
      planUpdate: boolean;
      planUpdateStage: string;
      planUpdateContext: any | null;
      phaseAcceptance: boolean;
      acceptanceSemanticValidation: any | null;
    };
  };
};
```

## 3. 初始化与迁移规则

- `ensureHarnessBucket(ctx)` 会确保上述字段存在，并补齐默认值。
- 若检测到旧结构，会执行迁移逻辑（例如 legacy plan revision 字段迁移到 plan update 字段）。
- 当前真值来源为：`payload.harness.__harnessBucketVersion`。
- `payload.harness.state.__harnessBucketVersion` 保留为兼容别名（映射到 bucket 顶层版本号）。

## 4. 读写约定

1. 新逻辑优先通过 `ensureHarnessBucket(ctx)` 获取并读写 bucket/state。
2. 非 harness 插件代码不应直接改写 `payload.harness.state` 内部细节。
3. 如需新增字段，优先在初始化默认值与迁移规则中一次性落地，避免版本分叉。
