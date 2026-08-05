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

    expect(workflowStore).toMatch(/return\s*\{\s*applyWorkflowRuntimeEvent[\s\S]*removeWorkflowOwnersForReplacedTurns/);
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
    const reconnectModel = source("src/modules/chat/model/reconnectReplayModel.js");
    const reconnectReplay = source("src/modules/chat/runtime/reconnect/messageReplay.js");
    const thinkingDetailsPanel = source("src/app/composables/useThinkingDetailsPanel.js");
    const thinkingPresentation = source("src/modules/chat/composables/thinkingPanelPresentation.js");
    const thinkingDetailsRenderer = source("src/modules/chat/components/thinking/ThinkingPanelDetails.vue");
    const thinkingRealtimeRenderer = source("src/modules/chat/components/thinking/ThinkingPanelRealtime.vue");
    const toolLogIdentity = source("src/modules/chat/model/toolLogIdentity.js");
    const turnUiStore = source("src/modules/chat/runtime/engine/turnUiStore.js");

    expect(merge).not.toMatch(/(?:turnScopeId|dialogProcessId|role)\s*[+:].*(?:turnScopeId|dialogProcessId|role)/);
    expect(subSessions).not.toMatch(/findIndex\([^)]*(?:turnScopeId|dialogProcessId|role)/s);
    expect(subSessions).toMatch(/message\?\.(?:messageId|id)/);
    expect(reconnectModel).not.toMatch(/byTurnScopeId/);
    expect(reconnectModel).toMatch(/presentationMessageId/);
    expect(reconnectReplay).not.toMatch(/messageItem\?\.(?:messageId|id)\).*nextMessageId/s);
    expect(reconnectReplay).toMatch(/messageItem\?\.presentationMessageId/);
    expect(thinkingDetailsPanel).not.toMatch(/leftTurnScopeId|leftDialogProcessId/);
    expect(thinkingDetailsPanel).toMatch(/leftPresentationMessageId/);
    expect(thinkingPresentation).not.toMatch(/toolLogIndex.*toolLogItem\?\.ts/s);
    expect(thinkingPresentation).toMatch(/eventId \? `event:\$\{eventId\}`/);
    expect(thinkingDetailsRenderer).toMatch(/:detail-text="item\.detailText"/);
    expect(thinkingDetailsRenderer).not.toMatch(/item\.detail\s*\|\||item\.data\?\.result/);
    expect(thinkingDetailsRenderer).not.toMatch(/item\.tool_call_id/);
    expect(thinkingRealtimeRenderer).toMatch(/:detail-text="logItem\.detailText"/);
    expect(thinkingRealtimeRenderer).not.toMatch(/logItem\.(?:id|seq|tool_call_id|timestamp|ts)|logIndex}`/);
    expect(toolLogIdentity).toMatch(/detail\(item\.detailText\)/);
    expect(toolLogIdentity).not.toMatch(/item\.content|item\.args|item\.result/);
    expect(toolLogIdentity).not.toMatch(/toolLogContentKey|findMatchIndex/);
    expect(toolLogIdentity).toMatch(/indexByEventId/);
    expect(turnUiStore).toMatch(/expandedToolDetailKeys/);
    expect(turnUiStore).not.toMatch(/expandedDetailLogKeys/);
  });

  it("keeps runtime breathing on the shared status and thinking container", () => {
    const sharedMessage = source("src/modules/chat/components/message/SharedChatMessageItem.vue");
    const thinkingRealtime = source("src/modules/chat/components/thinking/ThinkingPanelRealtime.vue");

    expect(sharedMessage).toMatch(/class="message-runtime-panels"[\s\S]*'is-running': unifiedRuntimePanelsRunning/);
    expect(sharedMessage).toMatch(/\.message-runtime-panels\.is-running\s*\{[\s\S]*animation:\s*message-runtime-panels-glow/);
    expect(sharedMessage).not.toMatch(/prefers-reduced-motion[\s\S]*message-runtime-panels\.is-running/);
    expect(thinkingRealtime).not.toMatch(/thinking-realtime-shell\.is-running\s*\{[\s\S]*animation:/);
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
    expect(reconnectComposable).not.toMatch(/upsertCanonicalAssistantMessage/);
    expect(reconnectComposable).toMatch(/protocolViolation[\s\S]*presentation_missing/);
    expect(batchReplay).toMatch(/findCanonicalMessageById\?\.\(targetSessionId, presentationMessageId\)/);
    expect(batchReplay).toMatch(/reason:\s*"target_missing"/);
    expect(batchReplay).not.toMatch(/find.*(?:ByRole|LastAssistant|ByDialogProcessId|ByTurnScopeId)/);
  });

  it("keeps Session detail and reconnect presentation ownership single-sourced", () => {
    const detailFiles = productionFiles("src/modules/session/model/list");
    const reconnectFiles = productionFiles("src/modules/chat/runtime/reconnect");
    const reconnectComposable = source("src/modules/chat/composables/useReconnectReplay.js");
    const detailProjection = source("src/modules/session/model/list/detailMessages.js");
    const detailMerge = source("src/modules/chat/model/sessionDetailMerge.js");
    const forbiddenDetailBranch = /preserveCurrentMessages|mergePreservedDetailMessages|merge-preserve-inflight/;

    expect(detailFiles.filter((relativePath) => forbiddenDetailBranch.test(source(relativePath)))).toEqual([]);
    expect(detailProjection).not.toMatch(/isSummaryDetail|foldMessagesForView/);
    expect(detailMerge).not.toMatch(/rawMessages[\s\S]*\?[^:]*:[^;]*messages/);
    expect(reconnectFiles.filter((relativePath) => /upsertCanonicalAssistantMessage/.test(source(relativePath)))).toEqual([]);
    expect(reconnectComposable).not.toMatch(/upsertCanonicalAssistantMessage/);
  });

  it("keeps live message events read-only after send preparation", () => {
    const projectionRouter = source("src/modules/chat/runtime/engine/messageProjectionRouter.js");
    expect(projectionRouter).toMatch(/findCanonicalMessageById\?\.\(targetSessionId, presentationMessageId\)/);
    expect(projectionRouter).not.toMatch(/upsertCanonicalAssistantMessage/);
  });

  it("routes child authoritative Turn events before the generic sub-session ignore boundary", () => {
    const sendRouter = source("src/modules/chat/runtime/engine/sendStreamEventRouter.js");
    const authorityRouteIndex = sendRouter.indexOf("routeForeignTurnLifecycleEvent(event, data");
    const ignoreIndex = sendRouter.indexOf("isIgnoredSubSessionEvent(event, data)");
    expect(authorityRouteIndex).toBeGreaterThan(-1);
    expect(ignoreIndex).toBeGreaterThan(authorityRouteIndex);
  });

  it("commits every Turn mutation through the store projection gateway", () => {
    const engine = source("src/modules/chat/composables/useChatEngine.js");
    const session = source("src/modules/chat/composables/useChatSession.js");
    const runtimeProjector = source("src/modules/chat/runtime/session/runtimeEventProjector.js");
    const store = source("src/modules/chat/stores/useChatStore.js");
    const registryImports = engine.match(
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*turnRuntimeRegistry\.js["']/,
    )?.[1] || "";

    expect(registryImports).not.toMatch(/\bapplyTurnTerminalResolution\b/);
    expect(engine).not.toMatch(/cloneTerminalDraft|projectAppliedTurnRuntime/);
    expect(session).toMatch(/commitTurnTerminalResolution:\s*chatStore\.applyTurnTerminalResolution/);
    expect(runtimeProjector).not.toMatch(/applyRunStateMessageRuntimePatch/);
    expect(store).not.toMatch(/onTurnCommitted[\s\S]*applyRunStateMessageRuntimePatch/);
  });

  it("keeps workflow transport projection in the declared extension point", () => {
    const sendRouter = source("src/modules/chat/runtime/engine/sendStreamEventRouter.js");
    const reconnectRouter = source("src/modules/chat/runtime/reconnect/reconnectEventReplay.js");
    const workflowPlugin = source("../../plugin/noobot-plugin-workflow/frontend/index.js");
    const manifest = JSON.parse(source("../../plugin/noobot-plugin-workflow/manifest.json"));

    expect(sendRouter).not.toMatch(/workflow_(?:planning_message_prepared|node_state_committed)|workflow_message_event/);
    expect(reconnectRouter).not.toMatch(/workflow_(?:planning_message_prepared|node_state_committed)|workflow_message_event/);
    expect(workflowPlugin).toMatch(/RUNTIME_STREAM_ROUTE|workflow-runtime-projector/);
    expect(manifest.contributes.frontend.extensions).toContainEqual({
      id: "workflow-runtime-projector",
      point: "runtime.stream.route",
    });
  });
});
