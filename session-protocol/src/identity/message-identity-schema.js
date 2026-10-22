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
const RECORD_STORES = Object.freeze([STORE.JOURNAL, STORE.CHECKPOINT, STORE.OUTBOX]);

const frozenList = (list) => (list ? Object.freeze([...list]) : null);

function renamed(field, stores, { roles = null, duplicateOf = null } = {}) {
  return Object.freeze({
    field,
    stores: Object.freeze(stores),
    roles: frozenList(roles),
    duplicateOf: frozenList(duplicateOf),
  });
}

function defineField(spec) {
  return Object.freeze({
    many: false,
    prefix: null,
    roles: null,
    requiredRoles: Object.freeze([]),
    acceptanceRequiredRoles: Object.freeze([]),
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

    roles: Object.freeze(["assistant", "tool"]),
    requiredRoles: Object.freeze(["assistant", "tool"]),
  }),
  userMessageId: defineField({
    kind: KIND.CORRELATION,
    category: CATEGORY.USER,
    prefix: "um_",
    roles: Object.freeze(["user"]),

    acceptanceRequiredRoles: Object.freeze(["user"]),
    renamedFrom: [
      renamed("messageId", RECORD_STORES, { roles: ["user"], duplicateOf: ["messageUid"] }),
    ],
  }),
  contextMessageId: defineField({
    kind: KIND.KEY,
    category: CATEGORY.CONTEXT,
    prefix: "cm_",
  }),
  sourceMessageUid: defineField({
    kind: KIND.REFERENCE,
    category: CATEGORY.SESSION,
  }),
  userMetaSourceMessageUid: defineField({
    kind: KIND.REFERENCE,
    category: CATEGORY.SESSION,
    renamedFrom: [renamed("userMetaMessageUid", [STORE.MODEL_CONTEXT_SNAPSHOT])],
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
  [MESSAGE_REMOVED_FIELD_NAME.NOOBOT_MESSAGE_ID]: "merged into additional_kwargs.messageUid",
});

export const MESSAGE_REMOVAL_REASON = Object.freeze({
  DUPLICATE: "duplicate",
  DERIVED: "derived",
  ORPHAN: "orphan",
});

function removal(
  field,
  stores,
  { roles = null, duplicateOf = null, consistentWith = null, reason },
) {
  return Object.freeze({
    field,
    stores: Object.freeze(stores),
    roles: frozenList(roles),
    duplicateOf: frozenList(duplicateOf),
    consistentWith,
    reason,
  });
}

export const MESSAGE_FIELD_REMOVALS = Object.freeze([
  removal("messageId", RECORD_STORES, {
    roles: ["system", "tool"],
    duplicateOf: ["messageUid"],
    reason: MESSAGE_REMOVAL_REASON.DUPLICATE,
  }),
  removal("userMetaMaterialized", RECORD_STORES, {
    roles: ["user"],
    consistentWith: (value, record) => value === (record.messageOrigin === "natural"),
    reason: MESSAGE_REMOVAL_REASON.DUPLICATE,
  }),
  removal("id", RECORD_STORES, {
    duplicateOf: ["messageUid", "messageId"],
    reason: MESSAGE_REMOVAL_REASON.DUPLICATE,
  }),
]);

export const MESSAGE_PATH_RULE_KIND = Object.freeze({
  REMOVE: "remove",
  RENAME: "rename",
  RECORD: "record",
  PROJECTION: "projection",
});

function pathRule(store, path, kind, spec = {}) {
  return Object.freeze({
    store,
    path: Object.freeze(path.split(".")),
    kind,
    fields: frozenList(spec.fields || null),
    target: spec.target || null,
    duplicateOf: frozenList(spec.duplicateOf || null),
    reason: spec.reason || null,
  });
}

const PATH = MESSAGE_PATH_RULE_KIND;

function renamePathRule(store, path, target) {
  const fields = MESSAGE_FIELD_SCHEMA[target].renamedFrom
    .filter((entry) => entry.stores.includes(store))
    .map((entry) => entry.field);
  return pathRule(store, path, PATH.RENAME, { fields, target });
}

const LEGACY_EVENT_MESSAGE_ID = Object.freeze({
  fields: ["messageId"],
  reason: MESSAGE_REMOVAL_REASON.DERIVED,
});
const RECORD_TIMELINE_RULES = (store, root) => [
  pathRule(store, `${root}.activityTimeline[]`, PATH.REMOVE, {
    fields: ["messageId"],
    reason: MESSAGE_REMOVAL_REASON.ORPHAN,
  }),
  pathRule(store, `${root}.toolTimeline[].call.log`, PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(store, `${root}.toolTimeline[].resultEvent.log`, PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
];

export const MESSAGE_PATH_RULES = Object.freeze([
  pathRule(STORE.JOURNAL, "message", PATH.RECORD),
  ...RECORD_TIMELINE_RULES(STORE.JOURNAL, "message"),
  pathRule(STORE.CHECKPOINT, "records[].message", PATH.RECORD),
  ...RECORD_TIMELINE_RULES(STORE.CHECKPOINT, "records[].message"),
  pathRule(STORE.SESSION, "turnLifecycle.turns.*", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  renamePathRule(STORE.SESSION, "turnLifecycle.replacedTurns.*", "replacementUserMessageUid"),
  renamePathRule(
    STORE.SESSION,
    "turnLifecycle.commandReceipts[].result.turnReplacement",
    "replacementUserMessageUid",
  ),
  pathRule(
    STORE.SESSION,
    "turnLifecycle.commandReceipts[].envelope",
    PATH.REMOVE,
    LEGACY_EVENT_MESSAGE_ID,
  ),
  pathRule(
    STORE.SESSION,
    "turnLifecycle.commandReceipts[].envelope.identity",
    PATH.REMOVE,
    LEGACY_EVENT_MESSAGE_ID,
  ),
  pathRule(
    STORE.SESSION,
    "turnLifecycle.commandReceipts[].envelope.payload",
    PATH.REMOVE,
    LEGACY_EVENT_MESSAGE_ID,
  ),
  pathRule(STORE.OUTBOX, "envelope", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(STORE.OUTBOX, "envelope.identity", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(STORE.OUTBOX, "envelope.payload", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(STORE.OUTBOX, "envelope.payload.contentFact", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(STORE.OUTBOX, "envelope.payload.sourceMessage", PATH.REMOVE, LEGACY_EVENT_MESSAGE_ID),
  pathRule(STORE.OUTBOX, "envelope.payload.presentation.userMessage", PATH.RECORD),
  pathRule(STORE.OUTBOX, "envelope.payload.presentation.assistantMessage", PATH.PROJECTION, {
    fields: ["messageId", "id"],
    duplicateOf: ["presentationMessageId"],
    reason: MESSAGE_REMOVAL_REASON.DUPLICATE,
  }),
]);

export function messagePathRulesFor(store) {
  const rules = MESSAGE_PATH_RULES.filter((rule) => rule.store === store);
  if (!rules.length) throw new TypeError(`message identity store has no path rules: ${store}`);
  return rules;
}

export function messageFieldRemovalsFor(store) {
  return MESSAGE_FIELD_REMOVALS.filter((entry) => entry.stores.includes(store));
}

export const MESSAGE_RECORD_REMOVED_FIELDS = Object.freeze([
  ...new Set(
    MESSAGE_FIELD_REMOVALS.filter((entry) => entry.stores.includes(STORE.JOURNAL)).map(
      (entry) => entry.field,
    ),
  ),
]);

export function messageRecordIdentityFieldsFor(role) {
  const scoped = Object.entries(MESSAGE_FIELD_SCHEMA).filter(([, spec]) => spec.roles);
  return Object.freeze({
    allowed: Object.freeze(scoped.filter(([, spec]) => spec.roles.includes(role)).map(([n]) => n)),
    forbidden: Object.freeze(
      scoped.filter(([, spec]) => !spec.roles.includes(role)).map(([n]) => n),
    ),
    required: Object.freeze(
      scoped.filter(([, spec]) => spec.requiredRoles.includes(role)).map(([n]) => n),
    ),
  });
}

export function acceptedMessageIdentityFieldsFor(role) {
  return Object.freeze(
    Object.entries(MESSAGE_FIELD_SCHEMA)
      .filter(([, spec]) => spec.acceptanceRequiredRoles.includes(role))
      .map(([name]) => name),
  );
}

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
