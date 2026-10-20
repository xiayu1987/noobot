#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineCheck, emptyRuleMeasurements, runCheckWhenMain } from "./quality/check-protocol.mjs";
import { readRepositoryText } from "./quality/repository-files.mjs";
import {
  addPatternLineHits,
  addRemovedPathHits,
  addMissingMarkerHits,
  addMissingConsumerHits,
} from "./quality/boundary-hits.mjs";

const PROTOCOL = "execution-isolation-protocol/src/protocol.js";
const DOCKER_SANDBOX = "agent/src/sandbox/docker-sandbox.js";
const SANDBOX_MAPPING = "path-resolver/src/sandbox-mapping.js";
const CHECK_TOOL_INPUT = "agent/src/tools/core/check-tool-input.js";
const OPERATION_DIRECTORY =
  "plugin/noobot-plugin-harness/src/capabilities/handlers/shared/operation-directory.js";
const ISOLATION_PROTOCOL_PACKAGE = "@noobot/execution-isolation-protocol";
const WORKSPACE_LITERAL = /["'`]\/workspace(?:\/|["'`])/;

const REMOVED_PATHS = Object.freeze([
  "agent-config-protocol/src/execution-isolation.js",
  "agent/src/tools/execution/script-tool/sandbox-config.js",
]);
const PROTOCOL_MARKERS = Object.freeze([
  "EXECUTION_ISOLATION_PROTOCOL_NAME",
  "TOOL_EXECUTION_CLASS",
  "TOOL_EXECUTION_VIEW",
  "normalizeSandboxMounts",
  "resolveWorkspaceSandboxLayout",
  "assertToolExecutionPolicy",
  "resolveToolExecutionPolicy",
]);
const CONSUMERS = Object.freeze([
  ["agent/src/config/index.js", ISOLATION_PROTOCOL_PACKAGE],
  [DOCKER_SANDBOX, ISOLATION_PROTOCOL_PACKAGE],
  [SANDBOX_MAPPING, ISOLATION_PROTOCOL_PACKAGE],
  [CHECK_TOOL_INPUT, "resolveExecutionIsolation"],
  ["agent/src/tools/core/workspace-io-executor.js", "assertToolExecutionPolicy"],
  [OPERATION_DIRECTORY, "resolveRuntimeOpsWorkdir"],
]);
const LEGACY_FIELD =
  /\b(?:dockerMounts|dockerContainerScope|dockerContainerName|dockerImage|dockerWorkdir|dockerLockWaitTimeoutMs|mountSource|mountTarget|mountDescription|dockerProjectMountSource|dockerProjectMountTarget|sandboxPathMappings)\b/;
const LINE_RULES = Object.freeze([
  ["legacyField", DOCKER_SANDBOX, LEGACY_FIELD, "legacy execution-isolation field"],
  ["legacyField", SANDBOX_MAPPING, LEGACY_FIELD, "legacy execution-isolation field"],
  ["legacyField", DOCKER_SANDBOX, /\bscriptConfig\b/, "scriptConfig instead of resolved policy"],
  ["duplicateLayout", DOCKER_SANDBOX, WORKSPACE_LITERAL, "workspace sandbox path literal"],
  [
    "duplicateLayout",
    "path-resolver/src/runtime-context.js",
    WORKSPACE_LITERAL,
    "workspace sandbox path literal",
  ],
  [
    "duplicateLayout",
    "path-resolver/src/tool-path.js",
    WORKSPACE_LITERAL,
    "workspace sandbox path literal",
  ],
  [
    "duplicateLayout",
    "agent/src/tools/execution/script-tool/constants.js",
    /runtime\/ops_workdir/,
    "operation directory literal",
  ],
  [
    "rawIsolationAccess",
    CHECK_TOOL_INPUT,
    /globalConfig.{0,80}executionIsolation/,
    "raw executionIsolation access",
  ],
  [
    "rawIsolationAccess",
    OPERATION_DIRECTORY,
    /globalConfig.{0,80}executionIsolation/,
    "raw executionIsolation access",
  ],
]);

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addRemovedPathHits(measured.removedProtocol, REMOVED_PATHS, "must remain removed");
  await addMissingMarkerHits(measured.protocolSurface, PROTOCOL, PROTOCOL_MARKERS);
  await addMissingConsumerHits(measured.protocolConsumer, CONSUMERS);
  for (const [rule, file, pattern, message] of LINE_RULES) {
    const source = await readRepositoryText(file);
    addPatternLineHits({ measurement: measured[rule], file, source, pattern, message });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "execution-isolation-protocol-boundary",
  description:
    "Execution isolation policy and sandbox layout are owned by execution-isolation-protocol",
  rules: {
    removedProtocol: {
      description: "Obsolete duplicate execution-isolation protocols stay deleted",
      hint: "delete the file and import from @noobot/execution-isolation-protocol",
    },
    protocolSurface: {
      description: "The protocol exports the isolation names, classes, layout and policy resolvers",
      hint: "restore the export in execution-isolation-protocol/src/protocol.js",
    },
    protocolConsumer: {
      description: "Isolation consumers read policy and layout through the protocol",
      hint: "import the listed protocol resolver instead of reading configuration directly",
    },
    legacyField: {
      description: "Obsolete docker and mount configuration fields stay removed",
      hint: "read the resolved isolation policy from the protocol",
    },
    duplicateLayout: {
      description: "Sandbox paths come from resolveWorkspaceSandboxLayout",
      hint: "use resolveWorkspaceSandboxLayout instead of a path literal",
    },
    rawIsolationAccess: {
      description:
        "Raw globalConfig.executionIsolation access is replaced by the protocol resolver",
      hint: "call the execution-isolation resolver instead of reading globalConfig",
    },
  },
  exemptions: [],
  baseline: {
    removedProtocol: 0,
    protocolSurface: 0,
    protocolConsumer: 0,
    legacyField: 0,
    duplicateLayout: 0,
    rawIsolationAccess: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
