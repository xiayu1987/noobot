#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { addPatternLineHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCANNED_ROOTS = Object.freeze(["agent", "model-runtime", "plugin"]);
const TOOL_ROOTS = Object.freeze(["agent/src/tools/", "agent/src/integrations/mcp/"]);
const CODE_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"]);
const DYNAMIC_STRUCTURED_TOOL = /\bDynamicStructuredTool\b/;
const RUNTIME_ABORT_SIGNAL = /\bruntime\??\.abortSignal\b/;

function isToolSource(file) {
  return TOOL_ROOTS.some((root) => file.startsWith(root));
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(SCANNED_ROOTS, {
    repositoryRoot,
    extensions: CODE_EXTENSIONS,
    includeTests: true,
  });
  for (const file of files) {
    const source = await readRepositoryText(file);
    addPatternLineHits({
      measurement: measured.dynamicStructuredTool,
      file,
      source,
      pattern: DYNAMIC_STRUCTURED_TOOL,
      message: "DynamicStructuredTool construction",
    });
    if (!isToolSource(file)) continue;
    addPatternLineHits({
      measurement: measured.runtimeAbortSignal,
      file,
      source,
      pattern: RUNTIME_ABORT_SIGNAL,
      message: "tool reads runtime.abortSignal",
    });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "tool-construction-protocol",
  description:
    "Tools are built only with tool(run, fields) and cancel only on the invocation signal",
  rules: {
    dynamicStructuredTool: {
      description: "No source constructs or imports DynamicStructuredTool",
      hint: 'use `import { tool } from "@langchain/core/tools"` with run(input, toolConfig)',
    },
    runtimeAbortSignal: {
      description: "Tool sources never read the main-turn runtime.abortSignal",
      hint: "read toolConfig.signal so capability invocations cancel the tool",
    },
  },
  exemptions: [],
  baseline: { dynamicStructuredTool: 0, runtimeAbortSignal: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
