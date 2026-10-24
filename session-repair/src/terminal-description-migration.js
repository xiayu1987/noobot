/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_ARTIFACT_TURN_TERMINAL_DESCRIPTION_SCHEMA_VERSION,
  SESSION_ARTIFACT_TURN_TERMINAL_STATUS_SCHEMA_VERSION,
  TURN_TERMINAL_FIXED_DESCRIPTION,
  TURN_TERMINAL_STATUS,
  normalizeTurnTerminalStatus,
} from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export const SESSION_TURN_TERMINAL_DESCRIPTION_MIGRATION = "turn-terminal-description-v14";

function protocolDescription(status) {
  if (status === TURN_TERMINAL_STATUS.COMPLETED) return "";
  return TURN_TERMINAL_FIXED_DESCRIPTION[status];
}

function unmigratable() {
  return Object.assign(
    new TypeError("Session turn terminalStatus description is not protocol-derivable"),
    { code: SESSION_REPAIR_ERROR_CODE.TURN_TERMINAL_STATUS_UNMIGRATABLE },
  );
}

export function migrateTurnTerminalDescription(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_TURN_TERMINAL_DESCRIPTION_SCHEMA_VERSION) {
    return;
  }
  const shapeMigrationPending =
    context.sourceSchemaVersion < SESSION_ARTIFACT_TURN_TERMINAL_STATUS_SCHEMA_VERSION;
  let migrated = false;
  for (const turn of Object.values(context.turns)) {
    const terminalStatus = turn?.terminalStatus;
    if (!isPlainObject(terminalStatus) || normalizeTurnTerminalStatus(terminalStatus)) continue;
    const description = protocolDescription(text(terminalStatus.status));
    if (description === undefined) {
      if (shapeMigrationPending) continue;
      throw unmigratable();
    }
    const rebuilt = normalizeTurnTerminalStatus({ ...terminalStatus, description });
    if (!rebuilt) {
      if (shapeMigrationPending) continue;
      throw unmigratable();
    }
    turn.terminalStatus = { ...rebuilt };
    migrated = true;
  }
  if (!migrated) return;
  context.changed = true;
  context.migrations.push(SESSION_TURN_TERMINAL_DESCRIPTION_MIGRATION);
}
