/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { executeSendEmail } from "./send-email.js";
import { executeListEmail } from "./list-email.js";
import { executeReadEmail } from "./read-email.js";
import { executeListFolders } from "./list-folders.js";
import { CONNECTOR_FAILURE_CODE } from "@noobot/connector-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import { commandOutput, connectorFailure, errorMessage } from "../channel-result.js";

const EMAIL_OPERATIONS = Object.freeze({
  send: ({ payload, connectionInfo }) => executeSendEmail({ payload, connectionInfo }),
  list: ({ payload, connectionInfo }) => executeListEmail({ payload, connectionInfo }),
  read: ({ payload, connectionInfo, attachmentHandler }) =>
    executeReadEmail({ payload, connectionInfo, attachmentHandler }),
  list_folders: ({ connectionInfo }) => executeListFolders({ connectionInfo }),
});

export async function executeEmailOperation({
  operation,
  input,
  connectionInfo,
  attachmentHandler,
}) {
  const action = text(operation);
  const run = Object.hasOwn(EMAIL_OPERATIONS, action) ? EMAIL_OPERATIONS[action] : null;
  if (!run) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "Email operation is invalid");
  }
  if (!isPlainObject(input)) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.INPUT_INVALID, "Email input must be an object");
  }
  try {
    const resultPayload = await run({ payload: input, connectionInfo, attachmentHandler });
    return commandOutput({ stdout: JSON.stringify(resultPayload) });
  } catch (error) {
    return connectorFailure(CONNECTOR_FAILURE_CODE.EXECUTION_FAILED, errorMessage(error));
  }
}
