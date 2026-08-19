/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { ESLint } from "eslint";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const baseline = Object.freeze({
  complexityCount: 601,
  longFunctionCount: 125,
  maxComplexity: 91,
  hotspots: Object.freeze({
    "agent/src/bot/session/detached-subsession-runner.js": [0, 0, 0],
    "agent/src/session/entities/session-entity.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/src/core/hooks/node-agent.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/useWorkflowNodeSessionViewer.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/live-projection-controller.js":
      [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/node-session-opening.js":
      [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/runtime-rebound.js":
      [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/snapshot-controller.js":
      [0, 0, 0],
    "client/noobot-chat/src/modules/chat/composables/message/useMessagePreview.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run-handler.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/active-run-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/command-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/event-listener-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/terminal-stage.js": [0, 0, 0],
    "authoritative-state/src/domain/turn-lifecycle-entity.js": [0, 0, 0],
    "authoritative-state/src/domain/turn-lifecycle-transition.js": [0, 0, 0],
    "client/noobot-chat/src/modules/chat/runtime/run-state-machine/turnReducer.js": [0, 0, 0],
    "client/noobot-chat/src/modules/chat/runtime/run-state-machine/turnRuntimeEventReducer.js": [
      0, 0, 0,
    ],
    "client/noobot-chat/src/modules/chat/runtime/run-state-machine/authoritativeTurnRuntime.js": [
      0, 0, 0,
    ],
    "client/noobot-chat/src/modules/chat/runtime/run-state-machine/turnLifecycleSnapshotProjection.js":
      [0, 0, 0],
    "agent/src/session/services/session-message-service/append-turn.js": [0, 0, 0],
    "agent/src/session/services/session-message-service/turn-upsert.js": [0, 0, 0],
    "agent/src/bot/execution/turn-persister.js": [0, 0, 0],
    "agent/src/runtime/tool-execution/tool-runner.js": [2, 32, 0],
    "agent/src/session/session-summary-builders/session-display-summary.js": [0, 0, 0],
    "agent/src/session/session-summary-builders/display-message-list.js": [0, 0, 0],
    "agent/src/session/session-summary-builders/display-tool-artifacts.js": [0, 0, 0],
    "agent/src/session/session-summary-builders/display-summary-stats.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/runtime/workflowNodeSessionDetail.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/runtime/workflowUnifiedSessionDetail.js": [0, 0, 0],
  }),
});

function summarize(messages = []) {
  let complexityCount = 0;
  let longFunctionCount = 0;
  let maxComplexity = 0;
  for (const message of messages) {
    if (message.ruleId === "complexity") {
      complexityCount += 1;
      const measured = Number(message.message.match(/complexity of (\d+)/)?.[1] || 0);
      maxComplexity = Math.max(maxComplexity, measured);
    }
    if (message.ruleId === "max-lines-per-function") longFunctionCount += 1;
  }
  return { complexityCount, maxComplexity, longFunctionCount };
}

function assertAtMost(violations, label, actual, allowed) {
  if (actual > allowed) violations.push(`${label}: ${actual} exceeds baseline ${allowed}`);
}

const lint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      files: ["**/*.{js,mjs,cjs,vue}"],
      rules: {
        complexity: ["error", 20],
        "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
      },
    },
  ],
});
const productionFiles = await getFirstPartyProductionFiles({ repositoryRoot: root });
const results = await lint.lintFiles(productionFiles);
const totals = summarize(results.flatMap(({ messages }) => messages));
const violations = [];
assertAtMost(violations, "complexity violations", totals.complexityCount, baseline.complexityCount);
assertAtMost(
  violations,
  "long-function violations",
  totals.longFunctionCount,
  baseline.longFunctionCount,
);
assertAtMost(violations, "maximum complexity", totals.maxComplexity, baseline.maxComplexity);

const byRelativePath = new Map(
  results.map((result) => [path.relative(root, result.filePath), summarize(result.messages)]),
);
for (const [relativePath, limits] of Object.entries(baseline.hotspots)) {
  const measured = byRelativePath.get(relativePath) || {
    complexityCount: 0,
    maxComplexity: 0,
    longFunctionCount: 0,
  };
  assertAtMost(violations, `${relativePath} complexity count`, measured.complexityCount, limits[0]);
  assertAtMost(violations, `${relativePath} maximum complexity`, measured.maxComplexity, limits[1]);
  assertAtMost(
    violations,
    `${relativePath} long-function count`,
    measured.longFunctionCount,
    limits[2],
  );
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Complexity baseline passed (${totals.complexityCount} complex, ${totals.longFunctionCount} long, max ${totals.maxComplexity})`,
  );
}
