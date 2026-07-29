/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { clientFilePath } from "@noobot/client-shared/path-resolver";

const projectRoot = clientFilePath.resolve(import.meta.dirname, "../../../../../");
const source = (relativePath) => readFileSync(clientFilePath.resolve(projectRoot, relativePath), "utf8");

function productionFiles(relativeDir = "src") {
  return readdirSync(clientFilePath.resolve(projectRoot, relativeDir), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return productionFiles(relativePath);
    return /\.(?:js|vue)$/.test(entry.name) ? [relativePath] : [];
  });
}

describe("workflow runtime architecture guard", () => {
  it("publishes only the versioned workflow runtime event write gateway", () => {
    const workflowStore = source("src/modules/chat/stores/chatStoreWorkflows.js");
    const chatStore = source("src/modules/chat/stores/useChatStore.js");

    expect(workflowStore).toMatch(/return\s*\{\s*applyWorkflowRuntimeEvent\s*\}/);
    expect(chatStore).not.toMatch(/\.\.\.subSessions/);
    expect(chatStore).not.toMatch(/upsertWorkflow(?:Planning|NodeState)Event/);
    expect(chatStore).not.toMatch(/mergeSubSessionSnapshot/);
  });

  it("keeps running placeholders out of production message models", () => {
    const violations = productionFiles().filter((relativePath) =>
      source(relativePath).includes("workflowNodeRunningPlaceholder"));
    expect(violations).toEqual([]);
  });

  it("does not reintroduce weak message identity matching", () => {
    const merge = source("src/modules/chat/model/sessionDetailMerge.js");
    const subSessions = source("src/modules/chat/stores/chatStoreSubSessions.js");

    expect(merge).not.toMatch(/(?:turnScopeId|dialogProcessId|role)\s*[+:].*(?:turnScopeId|dialogProcessId|role)/);
    expect(subSessions).not.toMatch(/findIndex\([^)]*(?:turnScopeId|dialogProcessId|role)/s);
    expect(subSessions).toMatch(/message\?\.(?:messageId|id)/);
  });

  it("keeps canonical workflow nodes on status without persisting stepStatus", () => {
    const workflowStore = source("src/modules/chat/stores/chatStoreWorkflows.js");
    expect(workflowStore).toMatch(/stepStatus:\s*_incomingStepStatus/);
    expect(workflowStore).toMatch(/stepStatus:\s*_currentStepStatus/);
    expect(workflowStore).not.toMatch(/next\s*=\s*\{[\s\S]*?stepStatus\s*:/);
  });

  it("keeps legacy reconnect metadata out of canonical assistant ownership", () => {
    const reconnectFiles = productionFiles("src/modules/chat/runtime/reconnect");
    const forbidden = /allowCreate|authoritativeCurrentRun|legacyDialogFallback|resolveReconnectTargetAssistantMessage|createFinalAssistantFromReconnectReplay/;
    const violations = reconnectFiles.filter((relativePath) => forbidden.test(source(relativePath)));
    expect(violations).toEqual([]);

    const hydration = source("src/modules/chat/runtime/reconnect/hydrationReplay.js");
    expect(hydration).not.toMatch(/findAssistantMessageByDialogProcessId|findLatestPendingAssistantAfterLastUser|getMessageRole/);
  });

  it("forbids DONE snapshots from becoming a canonical message projection entry", () => {
    const forbidden = /applyDoneMessages(?:Patch|FromReconnect)|reconcileDoneTurnSnapshot|onDoneMessages/;
    const violations = productionFiles().filter((relativePath) => forbidden.test(source(relativePath)));
    expect(violations).toEqual([]);
  });

  it("scopes reconnect replay by explicit session and presentation message identity", () => {
    const batchReplay = source("src/modules/chat/runtime/reconnect/batchReplay.js");
    const replayConsumer = source("src/modules/chat/runtime/reconnect/replayCacheConsumer.js");
    const reconnectComposable = source("src/modules/chat/composables/useReconnectReplay.js");

    expect(batchReplay).not.toMatch(/upsertCanonicalAssistantMessage/);
    expect(replayConsumer).not.toMatch(/upsertCanonicalAssistantMessage/);
    expect(reconnectComposable).toMatch(/hydrateActiveSessionBeforeReplay[\s\S]*upsertCanonicalAssistantMessage/);
    expect(batchReplay).toMatch(/findCanonicalMessageById\?\.\(targetSessionId, presentationMessageId\)/);
    expect(batchReplay).toMatch(/reason:\s*"target_missing"/);
    expect(batchReplay).not.toMatch(/find.*(?:ByRole|LastAssistant|ByDialogProcessId|ByTurnScopeId)/);
  });

  it("keeps live message events read-only after send preparation", () => {
    const projectionRouter = source("src/modules/chat/runtime/engine/messageProjectionRouter.js");
    expect(projectionRouter).toMatch(/findCanonicalMessageById\?\.\(targetSessionId, presentationMessageId\)/);
    expect(projectionRouter).not.toMatch(/upsertCanonicalAssistantMessage/);
  });
});
