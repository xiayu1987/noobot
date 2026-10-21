/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createSecureId } from "@noobot/shared/secure-identity";
import { MESSAGE_FIELD_SCHEMA } from "./message-identity-schema.js";

function generatedField(name) {
  if (!MESSAGE_FIELD_SCHEMA[name]?.prefix) {
    throw new TypeError(`${name} is not a generated message identity field`);
  }
  return name;
}

export const MESSAGE_IDENTITY_FIELD = Object.freeze({
  PRESENTATION: generatedField("presentationMessageId"),
  MODEL: generatedField("modelMessageId"),
  SESSION: generatedField("messageUid"),
  USER: generatedField("userMessageId"),
});

function randomId(field) {
  return createSecureId(MESSAGE_FIELD_SCHEMA[field].prefix, "");
}

export function createMessageUid() {
  return randomId(MESSAGE_IDENTITY_FIELD.SESSION);
}

export function createModelMessageId() {
  return randomId(MESSAGE_IDENTITY_FIELD.MODEL);
}

export function createPresentationMessageId() {
  return randomId(MESSAGE_IDENTITY_FIELD.PRESENTATION);
}

export function createUserMessageId() {
  return randomId(MESSAGE_IDENTITY_FIELD.USER);
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
