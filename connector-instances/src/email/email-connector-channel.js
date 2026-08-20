/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeSendEmail } from "./send-email.js";
import { executeListEmail } from "./list-email.js";
import { executeReadEmail } from "./read-email.js";
import { executeListFolders } from "./list-folders.js";

export async function executeEmailOperation({
  operation = "",
  input = {},
  connectionInfo = {},
  attachmentHandler = null,
} = {}) {
  try {
    const action = String(operation || "").trim();
    const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    if (!["send", "list", "read", "list_folders"].includes(action)) {
      throw new Error("Email operation is invalid");
    }
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
