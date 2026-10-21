/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MESSAGE_IDENTITY_CATEGORY = Object.freeze({
  SESSION: "session",
  MODEL: "model",
  PRESENTATION: "presentation",
  USER: "user",
  CONTEXT: "context",
});

export const MESSAGE_FIELD_KIND = Object.freeze({
  KEY: "key",
  CORRELATION: "correlation",
  REFERENCE: "reference",
  DERIVED: "derived",
});

export const MESSAGE_IDENTITY_STORE = Object.freeze({
  JOURNAL: "journal",
  CHECKPOINT: "checkpoint",
  SESSION: "session",
  OUTBOX: "outbox",
  MODEL_CONTEXT_SNAPSHOT: "model-context-snapshot",
});

export const MESSAGE_IDENTITY_STORE_POLICY = Object.freeze({
  rebuilt: Object.freeze(["session-summary"]),
  frozen: Object.freeze(["events", "execution-events", "debug-*"]),
});

const STORE = MESSAGE_IDENTITY_STORE;
const CATEGORY = MESSAGE_IDENTITY_CATEGORY;
const KIND = MESSAGE_FIELD_KIND;
const RECORD_STORES = Object.freeze([STORE.JOURNAL, STORE.CHECKPOINT]);

function renamed(field, stores, { roles = null, duplicateOf = null } = {}) {
  return Object.freeze({ field, stores: Object.freeze(stores), roles, duplicateOf });
}

function defineField(spec) {
  return Object.freeze({
    many: false,
    prefix: null,
    roles: null,
    requiredRoles: Object.freeze([]),
    derivedFrom: null,
    ...spec,
    renamedFrom: Object.freeze(spec.renamedFrom || []),
  });
}

export const MESSAGE_FIELD_SCHEMA = Object.freeze({
  messageUid: defineField({
    kind: KIND.KEY,
    category: CATEGORY.SESSION,
    prefix: "sm_",
  }),
  modelMessageId: defineField({
    kind: KIND.CORRELATION,
    category: CATEGORY.MODEL,
    prefix: "mm_",
    roles: Object.freeze(["assistant"]),
    requiredRoles: Object.freeze(["assistant"]),
    renamedFrom: [renamed("messageId", RECORD_STORES, { roles: ["assistant"] })],
  }),
  presentationMessageId: defineField({
    kind: KIND.CORRELATION,
    category: CATEGORY.PRESENTATION,
    prefix: "pm_",
  }),
  userMessageId: defineField({
    kind: KIND.CORRELATION,
    category: CATEGORY.USER,
    prefix: "um_",
    roles: Object.freeze(["user"]),
    renamedFrom: [
      renamed("messageId", RECORD_STORES, { roles: ["user"], duplicateOf: "messageUid" }),
    ],
  }),
  contextMessageId: defineField({
    kind: KIND.DERIVED,
    category: CATEGORY.CONTEXT,
    derivedFrom: CATEGORY.SESSION,
    renamedFrom: [renamed("additional_kwargs.messageUid", [STORE.MODEL_CONTEXT_SNAPSHOT])],
  }),
  replacementUserMessageUid: defineField({
    kind: KIND.REFERENCE,
    category: CATEGORY.SESSION,
    renamedFrom: [renamed("replacementUserMessageId", [STORE.SESSION])],
  }),
});

export const MESSAGE_REMOVED_FIELD_NAME = Object.freeze({
  MESSAGE_ID: "messageId",
  NOOBOT_MESSAGE_ID: "noobotMessageId",
});

export const MESSAGE_REMOVED_FIELD = Object.freeze({
  [MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID]:
    "split by role into modelMessageId and userMessageId; other roles duplicated messageUid",
  [MESSAGE_REMOVED_FIELD_NAME.NOOBOT_MESSAGE_ID]: "duplicate of contextMessageId",
});

export function isRegisteredMessageIdentityField(name) {
  return Object.hasOwn(MESSAGE_FIELD_SCHEMA, String(name));
}

const QUALIFIABLE_FIELD_SUFFIXES = Object.freeze(
  Object.keys(MESSAGE_FIELD_SCHEMA).map((name) => `${name[0].toUpperCase()}${name.slice(1)}`),
);

export function isCategorizedMessageIdentityName(name) {
  const singular = String(name).replace(/s$/, "");
  if (isRegisteredMessageIdentityField(singular)) return true;
  return QUALIFIABLE_FIELD_SUFFIXES.some(
    (suffix) =>
      singular.endsWith(suffix) && /^[a-z][A-Za-z]*$/.test(singular.slice(0, -suffix.length)),
  );
}

export function messageFieldRenamesFor(store) {
  return Object.entries(MESSAGE_FIELD_SCHEMA).flatMap(([to, spec]) =>
    spec.renamedFrom
      .filter((entry) => entry.stores.includes(store))
      .map((entry) =>
        Object.freeze({
          from: entry.field,
          to,
          roles: entry.roles,
          duplicateOf: entry.duplicateOf,
        }),
      ),
  );
}
