/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(import.meta.dirname, "..");
const productionRoots = [
  "agent/src",
  "service",
  "client/noobot-chat/src",
  "agent-proxy",
  "model-proxy",
  "plugin/noobot-plugin-harness/src",
  "plugin/noobot-plugin-workflow/src",
  "plugin/noobot-plugin-workflow/frontend",
];
const baseline = Object.freeze({
  complexityCount: 515,
  longFunctionCount: 119,
  maxComplexity: 106,
  hotspots: Object.freeze({
    "agent/src/bot/session/detached-subsession-runner.js": [0, 0, 0],
    "agent/src/session/entities/session-entity.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/src/core/hooks/node-agent.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/useWorkflowNodeSessionViewer.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/live-projection-controller.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/node-session-opening.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/runtime-rebound.js": [0, 0, 0],
    "plugin/noobot-plugin-workflow/frontend/composables/workflow-node-session-viewer/snapshot-controller.js": [0, 0, 0],
    "client/noobot-chat/src/modules/chat/composables/message/useMessagePreview.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run-handler.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/active-run-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/command-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/event-listener-stage.js": [0, 0, 0],
    "service/ws/chat-websocket/message-run/terminal-stage.js": [0, 0, 0],
  }),
});

function isProductionFile(filePath) {
  return !/(?:^|\/)(?:__tests__|tests)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(filePath);
}

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
const results = (await lint.lintFiles(productionRoots)).filter(({ filePath }) =>
  isProductionFile(filePath),
);
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
