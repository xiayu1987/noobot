/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_TRANSPORT_DEBUG_TYPE = "agent-transport";

const clean = (value) => String(value ?? "").trim();
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function resolveCommand(command) {
  if (isObject(command)) return command;
  try {
    const parsed = JSON.parse(String(command ?? ""));
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Returns correlation metadata only. Business payloads, credentials and user ids
 * are deliberately excluded so transport diagnostics are safe to retain.
 */
export function summarizeAgentTransportCommand(rawCommand, extra = {}) {
  const command = resolveCommand(rawCommand);
  const identity = isObject(command.identity) ? command.identity : {};
  const concurrency = isObject(command.concurrency) ? command.concurrency : {};
  return {
    protocolVersion: Number(command.protocolVersion) || null,
    commandType: clean(command.commandType).toLowerCase(),
    commandId: clean(command.commandId),
    sessionId: clean(identity.sessionId),
    parentSessionId: clean(identity.parentSessionId),
    dialogProcessId: clean(identity.dialogProcessId),
    parentDialogProcessId: clean(identity.parentDialogProcessId),
    turnScopeId: clean(identity.turnScopeId),
    topLevelFields: Object.keys(command).sort(),
    messageLength: typeof command.input?.message === "string" ? command.input.message.length : 0,
    attachmentCount: Array.isArray(command.input?.attachments) ? command.input.attachments.length : 0,
    selectedPluginCount: Array.isArray(command.preferences?.selectedPlugins)
      ? command.preferences.selectedPlugins.length
      : 0,
    expectedTurnRevision: Number.isInteger(concurrency.expectedTurnRevision)
      ? concurrency.expectedTurnRevision
      : null,
    expectedSessionVersion: Number.isInteger(concurrency.expectedSessionVersion)
      ? concurrency.expectedSessionVersion
      : null,
    createSessionIfAbsent: command.session?.createIfAbsent === true,
    hasUserIdField: Object.hasOwn(command, "userId") || Object.hasOwn(identity, "userId"),
    ...(isObject(extra) ? extra : {}),
  };
}
