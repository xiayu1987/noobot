/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../../events/index.js";
import { assertSessionFinalizationContext } from "@noobot/agent-transport-protocol/session-finalization";
import { assertAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";
import { createSessionExecutionMessageSource } from "@noobot/agent-transport-protocol/session-execution-result";
import { runBestEffort } from "@noobot/shared/best-effort";
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { summarizeExecutionLogs } from "../../observability/execution-log/execution-log-summary.js";
import {
  buildExecutionReport,
  EXECUTION_REPORT_STATUS,
} from "@noobot/session-protocol/execution-report";

export class SessionExecutionFinalizer {
  constructor({ session, memoryPostProcessService, now }) {
    this.session = session;
    this.memoryPostProcessService = memoryPostProcessService;
    this.now = now;
  }

  async finalizeRunSession({
    userId,
    sessionId,
    parentSessionId,
    parentDialogProcessId,
    caller,
    dialogProcessId,
    turnScopeId,
    startedAt,
    agentResult,
    turnPersistence,
    runtimeEventListener,
    userConfig,
    lifecycle,
    persistenceScope,
  }) {
    assertSessionFinalizationContext({
      lifecycle,
      runtimeEventListener,
      parentDialogProcessId,
      userConfig,
      turnPersistence,
    });
    requireDialogProcessKey(dialogProcessId);
    assertAgentTurnResult(agentResult);
    const messageSource = createSessionExecutionMessageSource({
      sessionId,
      dialogProcessId,
      turnScopeId,
    });
    const thinkingFinishedAt = this.now();
    lifecycle.enterPersisting();
    await turnPersistence.flush();
    await this.session.upsertTurnTiming({
      userId,
      sessionId,
      turnScopeId,
      dialogProcessId,
      thinkingFinishedAt,
      modelLoopRound: agentResult.modelLoopRound,
      persistenceScope,
    });

    const transferEnvelopes = await turnPersistence.readResultTransfers();
    lifecycle.enterMemory();
    const memoryPostProcessAsyncEnabled =
      this.memoryPostProcessService.resolveMemoryPostProcessAsyncEnabled(userConfig);
    const memoryPostProcessInput = {
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      persistenceScope,
      userConfig,
    };
    if (memoryPostProcessAsyncEnabled) {
      emitEvent(runtimeEventListener, "memory_postprocess_scheduled", {
        sessionId,
        mode: "async",
      });
      void runBestEffort(
        () =>
          this.memoryPostProcessService.runMemoryPostProcessFlow({
            ...memoryPostProcessInput,
            mode: "async",
          }),
        { operationName: "executionFinalizer.runAsyncMemoryPostProcess", context: { sessionId } },
      );
    } else {
      await this.memoryPostProcessService.runMemoryPostProcessFlow({
        ...memoryPostProcessInput,
        mode: "sync",
      });
    }

    await runtimeEventListener.flush();

    const executionLogs = await this.session.getExecutionTurnLogs({
      userId,
      sessionId,
      dialogProcessId,
      persistenceScope,
    });
    const executionSummary = summarizeExecutionLogs(executionLogs);
    await this.saveCompletedReport({
      userId,
      sessionId,
      parentSessionId,
      persistenceScope,
      dialogProcessId,
      turnScopeId,
      caller,
      startedAt,
      executionSummary,
    });
    return {
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      caller,
      answer: agentResult.output,
      traces: agentResult.traces,
      messageSource,
      transferEnvelopes,
      dialogProcessId,
      turnScopeId,
    };
  }

  async saveCompletedReport({ userId, persistenceScope, ...reportFields }) {
    const report = buildExecutionReport({
      ...reportFields,
      status: EXECUTION_REPORT_STATUS.COMPLETED,
      finishedAt: this.now(),
    });
    await this.session.saveExecutionReport({
      userId,
      sessionId: reportFields.sessionId,
      persistenceScope,
      report,
    });
  }
}
