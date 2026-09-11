/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentContextBuildEnvelope } from "@noobot/context-protocol";
import { createAgentExecutionScope } from "../../src/context/agent-execution-scope.js";
import { PATH_REF_VIEWS, isHostFilesystemSentinel } from "@noobot/path-resolver";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import { TOOL_NAME } from "../../src/tools/constants/index.js";
import {
  HELP_COMMAND,
  HELP_COMMAND_NAMES,
  HELP_COMMAND_OPTIONS,
  HELP_OPTION,
} from "../../src/tools/collaboration/help-command-contract.js";
import {
  HELP_PARSE_ERROR,
  parseHelpCommand,
} from "../../src/tools/collaboration/help-command-parser.js";
import {
  ATTACHMENT_SOURCES,
  EXPERIENCE_PATH_FIELDS,
  MEMORY_PATH_FIELDS,
  TOOL_SOURCE,
  buildContextSection,
  buildIsolationSection,
  buildModelsSection,
  buildRuntimeSection,
  projectAttachmentRecord,
  projectPathFields,
  resolveAvailableTools,
} from "../../src/tools/collaboration/help-sections.js";
import { createHelpTool } from "../../src/tools/collaboration/help-tool.js";
import { projectToolResultForModel } from "../../src/tools/core/tool-json-result.js";

function isAbsoluteAnyPlatform(value) {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(String(value || ""));
}

const IDENTITY = Object.freeze({
  userId: "tester",
  sessionId: "sess-1",
  dialogProcessId: "dialog-1",
  turnScopeId: "client-turn:1",
  messageId: "msg-1",
});

const FIXTURE_TOOL_NAMES = Object.freeze(["help", "read_file", "search"]);

function createScope({
  attachmentService = null,
  toolNames = FIXTURE_TOOL_NAMES,
  globalConfig = {},
  identity = IDENTITY,
} = {}) {
  return createAgentExecutionScope({
    context: createAgentContextBuildEnvelope({ identity }),
    bindings: {
      tools: toolNames.map((name) => ({ name, func: async () => "" })),
      runtime: {
        basePath: "/tmp/help-scope",
        globalConfig,
        ...(attachmentService ? { attachmentService } : {}),
        systemRuntime: {
          userId: identity.userId,
          sessionId: identity.sessionId,
          dialogProcessId: identity.dialogProcessId,
          turnScopeId: identity.turnScopeId,
          caller: "user",
          now: "2026-01-01T00:00:00.000Z",
          isSuperUser: true,
        },
      },
    },
  });
}

function createStubScope({ attachmentService = null, identity = IDENTITY } = {}) {
  return {
    context: { identity },
    bindings: {
      tools: FIXTURE_TOOL_NAMES.map((name) => ({ name, func: async () => "" })),
      extensions: {},
      runtime: {
        basePath: "/tmp/help-scope",
        globalConfig: {},
        ...(attachmentService ? { attachmentService } : {}),
        systemRuntime: {
          ...identity,
          caller: "user",
          now: "2026-01-01T00:00:00.000Z",
          isSuperUser: true,
        },
      },
    },
  };
}

test("empty command resolves to the command index instead of failing", () => {
  for (const input of ["", "   ", undefined]) {
    const parsed = parseHelpCommand(input);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "");
  }
});

test("every declared command parses without options", () => {
  for (const name of HELP_COMMAND_NAMES) {
    const parsed = parseHelpCommand(`--${name}`);
    assert.equal(parsed.ok, true, `--${name} must parse`);
    assert.equal(parsed.command, name);
  }
});

test("command options parse and stay bound to their command", () => {
  const withName = parseHelpCommand("--tools --name read_file");
  assert.equal(withName.ok, true);
  assert.equal(withName.command, HELP_COMMAND.TOOLS);
  assert.equal(withName.options[HELP_OPTION.NAME], "read_file");

  const withId = parseHelpCommand("--attachs --id abc-123");
  assert.equal(withId.ok, true);
  assert.equal(withId.options[HELP_OPTION.ID], "abc-123");

  const crossed = parseHelpCommand("--tools --id abc-123");
  assert.equal(crossed.ok, false);
  assert.equal(crossed.reason, HELP_PARSE_ERROR.OPTION_NOT_SUPPORTED);
  assert.deepEqual(crossed.allowedOptions, [...HELP_COMMAND_OPTIONS[HELP_COMMAND.TOOLS]]);
});

test("malformed commands fail with a specific reason rather than a fuzzy match", () => {
  assert.equal(parseHelpCommand("--nope").reason, HELP_PARSE_ERROR.UNKNOWN_COMMAND);
  assert.equal(parseHelpCommand("tools").reason, HELP_PARSE_ERROR.MALFORMED);
  assert.equal(parseHelpCommand("--tools --runtime").reason, HELP_PARSE_ERROR.MULTIPLE_COMMANDS);
  assert.equal(parseHelpCommand("--tools --bogus x").reason, HELP_PARSE_ERROR.UNKNOWN_OPTION);
});

test("experience and memory fields project as workspace refs with no host path", () => {
  const projected = {
    ...projectPathFields(EXPERIENCE_PATH_FIELDS),
    ...projectPathFields(MEMORY_PATH_FIELDS),
  };
  const entries = Object.entries(projected);
  assert.ok(entries.length > 0);
  for (const [field, ref] of entries) {
    assert.equal(ref.view, PATH_REF_VIEWS.WORKSPACE, `${field} must project as workspace`);
    assert.equal(isAbsoluteAnyPlatform(ref.path), false, `${field} must not expose a host path`);
    assert.equal(Object.isFrozen(ref), true, `${field} must be frozen`);
  }
});

test("isolation section narrows to the available tools and keeps empty classes", () => {
  const isolation = buildIsolationSection(FIXTURE_TOOL_NAMES);
  assert.ok(isolation.modes.length > 0);
  assert.ok(isolation.executionClasses.length > 0);
  const covered = Object.keys(isolation.toolsByExecutionClass);
  assert.deepEqual(
    covered.sort(),
    [...isolation.executionClasses].sort(),
    "every execution class must keep its key even when it holds no available tool",
  );
  const flattened = Object.values(isolation.toolsByExecutionClass).flat();
  assert.ok(flattened.includes("help"), "help itself must be classified");
  for (const toolName of flattened) {
    assert.ok(
      FIXTURE_TOOL_NAMES.includes(toolName),
      `${toolName} is in the static registry but was not assembled, so it must not be classified`,
    );
  }
  assert.deepEqual(
    Object.keys(buildIsolationSection().toolsByExecutionClass).sort(),
    covered.sort(),
  );
  assert.deepEqual(Object.values(buildIsolationSection().toolsByExecutionClass).flat(), []);
});

test("attachment projection strips host paths and emits an attachment ref", () => {
  const projected = projectAttachmentRecord({
    attachmentId: "att-1",
    sessionId: "sess-1",
    attachmentSource: ATTACHMENT_SOURCES[0],
    name: "note.txt",
    mimeType: "text/plain",
    size: 12,
    relativePath: "runtime/attach/note.txt",
    path: "/host/abs/runtime/attach/note.txt",
    absolutePath: "/host/abs/runtime/attach/note.txt",
  });

  assert.equal("path" in projected, false, "host path must be dropped");
  assert.equal("absolutePath" in projected, false, "host absolute path must be dropped");
  assert.equal("relativePath" in projected, false, "raw relative path must be replaced by pathRef");
  assert.equal(projected.name, "note.txt");
  assert.equal(projected.mimeType, "text/plain");
  assert.equal(projected.size, 12);
  assert.equal(
    "attachmentId" in projected,
    false,
    "raw attachment id must not sit beside attachmentRef",
  );
  assert.equal("sessionId" in projected, false, "raw session id must not sit beside attachmentRef");
  assert.equal(
    "attachmentSource" in projected,
    false,
    "raw attachment source must not sit beside attachmentRef",
  );
  assert.equal(projected.pathRef.view, PATH_REF_VIEWS.WORKSPACE);
  assert.equal(isAbsoluteAnyPlatform(projected.pathRef.path), false);
  assert.equal(
    typeof projected.attachmentRef,
    "string",
    "attachmentRef must stay a flat string produced by formatAttachmentIdentityRef",
  );
  assert.equal(
    projected.attachmentRef,
    formatAttachmentIdentityRef({
      attachmentId: "att-1",
      sessionId: "sess-1",
      attachmentSource: ATTACHMENT_SOURCES[0],
    }),
  );
});

test("runtime section projects every directory through the path resolver", () => {
  const runtime = buildRuntimeSection(createScope());
  assert.ok(Object.keys(runtime.directories).length > 0, "directories must not be empty");
  const refs = [
    ...Object.values(runtime.directories),
    ...runtime.allowedRoots,
    ...(runtime.extraMountTargets || []),
  ];
  for (const ref of refs) {
    assert.ok(Object.values(PATH_REF_VIEWS).includes(ref.view), "view must be a declared view");
    assert.equal(Object.isFrozen(ref), true);
  }
  assert.equal(typeof runtime.relativePathBase, "string");
  assert.equal(typeof runtime.sandbox.enabled, "boolean");
});

test("runtime section keeps the host filesystem sentinel out of path projection", () => {
  const runtime = buildRuntimeSection(createScope());
  for (const ref of runtime.allowedRoots) {
    if (!isHostFilesystemSentinel(ref.scope)) continue;
    assert.equal(ref.view, PATH_REF_VIEWS.HOST);
    assert.equal(ref.path, undefined, "a sentinel is not a real path and must stay in scope only");
  }
  const projected = runtime.allowedRoots.filter((ref) => typeof ref.path === "string");
  for (const ref of projected) {
    assert.equal(isHostFilesystemSentinel(ref.path), false);
  }
});

test("tool manual result never overrides the help tool identity", async () => {
  const [helpTool] = createHelpTool({ agentContext: createScope() });
  for (const command of ["--tools --name patch_file", "--tools --name no_such_tool"]) {
    const parsed = JSON.parse(await helpTool.func({ command }));
    assert.equal(parsed.toolName, "help", `${command} must keep help identity`);
    assert.equal(typeof parsed.queriedTool, "string");
  }
});

test("context section exposes only whitelisted identity plus harmless metadata", () => {
  const context = buildContextSection(createScope());
  assert.deepEqual(Object.keys(context).sort(), ["caller", "identity", "isSuperUser", "timestamp"]);
  const allowed = [
    "userId",
    "sessionId",
    "rootSessionId",
    "parentSessionId",
    "dialogProcessId",
    "turnScopeId",
  ];
  for (const field of Object.keys(context.identity)) {
    assert.ok(allowed.includes(field), `${field} must be whitelisted`);
  }
  const serialized = JSON.stringify(context).toLowerCase();
  for (const forbidden of ["apikey", "api_key", "secret", "token", "password", "config"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must never be exposed`);
  }
});

test("attachs results survive the model projection layer without mixed or incomplete attachment identity", async () => {
  const record = {
    attachmentId: "att-1",
    sessionId: IDENTITY.sessionId,
    attachmentSource: ATTACHMENT_SOURCES[0],
    name: "note.txt",
    mimeType: "text/plain",
    size: 12,
    path: "/host/abs/runtime/attach/note.txt",
    relativePath: "runtime/attach/note.txt",
  };
  const attachmentService = {
    async readAttachmentMetas({ attachmentSource }) {
      return attachmentSource === ATTACHMENT_SOURCES[0] ? [record] : [];
    },
    async getAttachmentById({ attachmentSource, attachmentId }) {
      return attachmentSource === ATTACHMENT_SOURCES[0] && attachmentId === record.attachmentId
        ? record
        : null;
    },
  };
  const [tool] = createHelpTool({ agentContext: createScope({ attachmentService }) });

  for (const command of [
    "--attachs",
    "--attachs --id att-1",
    "--attachs --id missing",
    `--attachs --source ${ATTACHMENT_SOURCES[1]}`,
    "--attachs --source bogus",
  ]) {
    const raw = await tool.func({ command });
    const projected = projectToolResultForModel(raw);
    assert.equal(typeof projected, "string", `${command} must project to a string`);
    assert.doesNotMatch(projected, /"path":"\/host/, `${command} must not leak host paths`);
  }

  const listed = JSON.parse(projectToolResultForModel(await tool.func({ command: "--attachs" })));
  assert.equal(listed.bySource[0].source, ATTACHMENT_SOURCES[0]);
  assert.equal(typeof listed.bySource[0].attachments[0].attachmentRef, "string");
});

test("parse failures surface a translated reason rather than the raw key", async () => {
  const [tool] = createHelpTool({ agentContext: createScope() });
  const raw = await tool.func({ command: "--bogus" });
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.equal(payload.ok, false);
  assert.notEqual(payload.reason, HELP_PARSE_ERROR.UNKNOWN_COMMAND);
  assert.ok(payload.reason.length > 0);
  assert.deepEqual(
    payload.commands,
    HELP_COMMAND_NAMES.map((name) => `--${name}`),
  );
});

test("tools listing comes from runtime bindings rather than the static registry", async () => {
  const available = resolveAvailableTools(createScope());
  assert.equal(available.source, TOOL_SOURCE.RUNTIME_BINDINGS);
  assert.deepEqual(available.toolNames, [...FIXTURE_TOOL_NAMES].sort());

  const [tool] = createHelpTool({ agentContext: createScope() });
  const listed = JSON.parse(await tool.func({ command: "--tools" }));
  assert.equal(listed.toolSource, TOOL_SOURCE.RUNTIME_BINDINGS);
  assert.deepEqual(listed.toolNames, [...FIXTURE_TOOL_NAMES].sort());
  assert.equal(
    listed.toolNames.includes(TOOL_NAME.EXECUTE_SCRIPT),
    false,
    "a registered but unassembled tool must never reach the listing",
  );
});

test("querying a registered but unassembled tool reports it as unavailable and hides its manual", async () => {
  const [tool] = createHelpTool({ agentContext: createScope() });
  const parsed = JSON.parse(
    await tool.func({ command: `--tools --name ${TOOL_NAME.EXECUTE_SCRIPT}` }),
  );
  assert.equal(parsed.queriedTool, TOOL_NAME.EXECUTE_SCRIPT);
  assert.equal(parsed.manual, null, "an unavailable tool must not expose its manual");
  assert.ok(parsed.reason.length > 0);
  assert.equal(parsed.toolSource, TOOL_SOURCE.RUNTIME_BINDINGS);

  const availableQuery = JSON.parse(await tool.func({ command: "--tools --name read_file" }));
  assert.equal(availableQuery.queriedTool, "read_file");
  assert.notEqual(availableQuery.manual, null, "an available tool must expose its manual");
});

test("models section excludes providers disabled by enabled false", async () => {
  const globalConfig = {
    providers: {
      alpha: { model: "alpha-1", description: "on" },
      beta: { model: "beta-1", enabled: false },
    },
  };
  const section = buildModelsSection(createScope({ globalConfig }));
  const aliases = section.available.map((entry) => entry.alias);
  assert.ok(aliases.includes("alpha"));
  assert.equal(aliases.includes("beta"), false, "a disabled provider must not be listed");
  assert.equal(typeof section.current.alias, "string");

  const [tool] = createHelpTool({ agentContext: createScope({ globalConfig }) });
  const parsed = JSON.parse(await tool.func({ command: `--${HELP_COMMAND.MODELS}` }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.available.map((entry) => entry.alias),
    aliases,
  );
  assert.equal(typeof parsed.current, "object");
});

test("attachs reports each missing precondition with its own reason", async () => {
  const attachmentService = {
    async readAttachmentMetas() {
      return [];
    },
  };
  async function attachsReason(scopeOptions) {
    const [tool] = createHelpTool({ agentContext: createScope(scopeOptions) });
    const parsed = JSON.parse(await tool.func({ command: `--${HELP_COMMAND.ATTACHS}` }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.command, HELP_COMMAND.ATTACHS);
    assert.ok(parsed.reason.length > 0);
    return parsed.reason;
  }
  async function stubAttachsReason(scopeOptions) {
    const [tool] = createHelpTool({ agentContext: createStubScope(scopeOptions) });
    const parsed = JSON.parse(await tool.func({ command: `--${HELP_COMMAND.ATTACHS}` }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.command, HELP_COMMAND.ATTACHS);
    assert.ok(parsed.reason.length > 0);
    return parsed.reason;
  }

  const serviceMissing = await attachsReason({ attachmentService: null });
  const userIdMissing = await attachsReason({
    attachmentService,
    identity: { ...IDENTITY, userId: "" },
  });
  const sessionIdMissing = await stubAttachsReason({
    attachmentService,
    identity: { ...IDENTITY, sessionId: "" },
  });

  const reasons = [serviceMissing, userIdMissing, sessionIdMissing];
  assert.equal(
    new Set(reasons).size,
    3,
    "a missing attachment service and a missing identity need different handling, so they must not share one reason",
  );
  for (const reason of reasons) {
    assert.equal(
      reason.startsWith("tools.help."),
      false,
      `${reason} must be a translated message, not a raw i18n key leaked by a missing entry`,
    );
  }
});
