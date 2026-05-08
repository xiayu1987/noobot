/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tSystem } from "../../i18n/system-text.js";
import { executeSendEmail } from "./send-email.js";
import { executeListEmail } from "./list-email.js";
import { executeReadEmail } from "./read-email.js";
import { executeListFolders } from "./list-folders.js";

function parseEmailCommand(command = "") {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    throw new Error(tSystem("connectors.email.commandRequired"));
  }
  let parsedCommand = null;
  try {
    parsedCommand = JSON.parse(normalizedCommand);
  } catch {
    throw new Error(
      `${tSystem("connectors.email.commandJsonStringRequired")}, e.g. {"action":"send",...}`,
    );
  }
  if (!parsedCommand || typeof parsedCommand !== "object") {
    throw new Error(tSystem("connectors.email.commandJsonObjectRequired"));
  }
  const action = String(parsedCommand?.action || "").trim().toLowerCase();
  if (!["send", "list", "read", "list_folders"].includes(action)) {
    throw new Error(tSystem("connectors.email.commandActionInvalid"));
  }
  return { action, payload: parsedCommand };
}

export async function executeEmailCommand({
  command = "",
  connectionInfo = {},
  attachmentHandler = null,
} = {}) {
  try {
    const { action, payload } = parseEmailCommand(command);
    let resultPayload = {};
    if (action === "send") {
      resultPayload = await executeSendEmail({ payload, connectionInfo });
    } else if (action === "list") {
      resultPayload = await executeListEmail({ payload, connectionInfo });
    } else if (action === "read") {
      resultPayload = await executeReadEmail({
        payload,
        connectionInfo,
        attachmentHandler,
      });
    } else if (action === "list_folders") {
      resultPayload = await executeListFolders({ connectionInfo });
    }
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify(resultPayload),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: String(error?.message || error || "email command failed"),
    };
  }
}
