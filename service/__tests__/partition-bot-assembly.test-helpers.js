/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BotManager } from "#agent/bot";
import { createGlobalConfigBuilder } from "#agent/config";
import { createConfiguredSessionRuntime } from "../bootstrap/create-app-dependencies.js";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createRuntimeConfigService } from "../services/runtime-config-service.js";
import { createServiceBotAccess } from "../services/service-bot-access.js";
import {
  prepareWorkspaceLayout,
  resolveWorkspaceBackupBase,
} from "../../agent/src/workspace-lifecycle/sections.js";
import { journalTestLimits } from "../../agent/__tests__/helpers/partition-journal-cases.js";
import { createAcceptedAgentExecution } from "../../agent/__tests__/helpers/accepted-run-identity.js";

export const committedAt = "2026-11-20T00:00:00.000Z";
export const identity = { userId: "user", sessionId: "session", persistenceScope: null };

export function firstSend(sessionIdentity = identity) {
  const turnScopeId = "turn";
  return {
    ...sessionIdentity,
    parentSessionId: "",
    turnScopeId,
    commandId: "first-send",
    causationId: "first-send",
    presentationMessageId: "presentation",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution(turnScopeId, sessionIdentity.sessionId),
    userMessage: { content: "分区 Bot input", userMessageId: "um_first", messageOrigin: "natural" },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  };
}

export async function provisionPartitionTestWorkspace(workspaceRoot, userId) {
  const base = join(workspaceRoot, userId);
  await mkdir(base);
  await prepareWorkspaceLayout({
    base,
    backupBase: resolveWorkspaceBackupBase(base),
    created: true,
    resetSections: [],
  });
}

export async function createPartitionBotFixture(
  t,
  { assemble = createConfiguredSessionRuntime, pluginRootDir } = {},
) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-bot-assembly-"));
  const fixture = createPartitionBotRuntime(t, { workspaceRoot, assemble, pluginRootDir });
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await provisionPartitionTestWorkspace(workspaceRoot, identity.userId);
  return fixture;
}

export function createPartitionBotRuntime(
  t,
  { workspaceRoot, assemble = createConfiguredSessionRuntime, pluginRootDir },
) {
  const bots = [];
  const state = { bot: null };
  const budget = {
    journalLimits: journalTestLimits({ transactionBytes: 16 * 1024 }),
    maxJournals: 1,
  };
  let partitionSessionStorage = budget;
  let assemblyAttempts = 0;
  let assemblyFailure = null;
  const access = createServiceBotAccess({ getBot: () => state.bot });
  t.after(async () => {
    const results = await Promise.allSettled(bots.map((bot) => bot.close()));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Bot cleanup failed",
      );
  });
  const service = createRuntimeConfigService({
    startupContext: { paths: { pluginRootDir: pluginRootDir ?? join(workspaceRoot, "plugins") } },
    readWorkspaceConfigParams: async () => ({ values: {} }),
    globalConfigBuilder: createGlobalConfigBuilder({
      source: {
        name: "partition-bot-assembly",
        async loadRawConfig() {
          const workspaceTemplatePath = fileURLToPath(
            new URL("../../user-template/default-user", import.meta.url),
          );
          return partitionSessionStorage === undefined
            ? { workspaceRoot, workspaceTemplatePath }
            : { workspaceRoot, workspaceTemplatePath, partitionSessionStorage };
        },
      },
    }),
    BotManager,
    createSessionRuntime: (config, dependencies) => {
      assemblyAttempts += 1;
      if (assemblyFailure) throw assemblyFailure;
      return assemble(config, dependencies);
    },
    now: () => committedAt,
    connectorAccessPort: { access() {}, listUserConnectors() {} },
    getBot: () => state.bot,
    setBot(bot) {
      state.bot = bot;
      bots.push(bot);
    },
    withBotRetirement: access.withRetirement,
    setGlobalConfigRaw() {},
    setGlobalConfig() {},
  });
  return {
    service,
    access,
    state,
    budget,
    workspaceRoot,
    get assemblyAttempts() {
      return assemblyAttempts;
    },
    setBudget(value) {
      partitionSessionStorage = value;
    },
    failAssembly(cause) {
      assemblyFailure = cause;
    },
  };
}
