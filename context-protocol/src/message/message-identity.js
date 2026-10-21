/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createSecureId } from "@noobot/shared/secure-identity";

export const MESSAGE_IDENTITY_FIELD = Object.freeze({
  PRESENTATION: "presentationMessageId",
  MODEL: "modelMessageId",
  SESSION: "messageUid",
  USER: "userMessageId",
});

function randomId(prefix) {
  return createSecureId(prefix, "");
}

export function createMessageUid() {
  return randomId("sm_");
}

export function createModelMessageId() {
  return randomId("msg_");
}

export function createPresentationMessageId() {
  return randomId("msg_");
}

export function createUserMessageId() {
  return randomId("msg_");
}

export function isMessageIdentity(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export function assertMessageIdentity(field, value) {
  if (!Object.values(MESSAGE_IDENTITY_FIELD).includes(field)) {
    throw new TypeError(`unknown message identity field: ${field}`);
  }
  if (!isMessageIdentity(value)) {
    throw new TypeError(`invalid ${field}`);
  }
  return value;
}
