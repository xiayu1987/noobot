/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  EXECUTION_CHILDREN_WIRE_EVENT,
  EXECUTION_LIFECYCLE_WIRE_EVENT,
  EXECUTION_SNAPSHOT_WIRE_EVENT,
  EXECUTION_TREE_WIRE_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_SNAPSHOT_WIRE_EVENT,
  validateExecutionIdentity,
  validateSessionEvent,
} from "@noobot/session-protocol";
import {
  ATTACHMENT_LIFECYCLE_WIRE_EVENT,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import { validateEventEnvelope } from "./envelope.js";
import {
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
  validateInteractionRequestPayload,
  validateInteractionResponsePayload,
} from "./interaction.js";
import {
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_WIRE_EVENT,
  validateMessageEventPayload,
} from "./message-event.js";
import {
  validateWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
} from "./workflow-runtime-event.js";
import { validateTurnSnapshotEnvelope } from "./turn-snapshot.js";

export const EVENT_AUTHORITY = Object.freeze({ AUTHORITATIVE: "authoritative" });
export const EVENT_REDUCER_TARGET = Object.freeze({
  TURN: "turn",
  EXECUTION: "execution",
  ATTACHMENT: "attachment",
  INTERACTION: "interaction",
  MESSAGE: "message",
  WORKFLOW: "workflow",
});
export const EVENT_REDUCER_INPUT = Object.freeze({
  ENVELOPE: "envelope",
  IDENTITY_PAYLOAD: "identity_payload",
  PAYLOAD: "payload",
});
export const EVENT_FAMILY = Object.freeze({
  TURN_LIFECYCLE: "turn.lifecycle",
  TURN_SNAPSHOT: "turn.snapshot",
  EXECUTION_LIFECYCLE: "execution.lifecycle",
  EXECUTION_SNAPSHOT: "execution.snapshot",
  EXECUTION_CHILDREN: "execution.children",
  EXECUTION_TREE: "execution.tree",
  ATTACHMENT_LIFECYCLE: "attachment.lifecycle",
  INTERACTION_REQUEST: "interaction.request",
  INTERACTION_RESPONSE: "interaction.response",
  MESSAGE_TIMELINE: "message.timeline",
  WORKFLOW_RUNTIME: "workflow.runtime",
});

const domainResult = (result, fallback = "invalid_domain_payload") => {
  if (result?.valid === true) return { valid: true, errors: [] };
  const errors =
    Array.isArray(result?.errors) && result.errors.length
      ? result.errors
      : Array.isArray(result?.missing) && result.missing.length
        ? result.missing
        : [result?.reason || fallback];
  return { valid: false, errors };
};
const validateAttachment = (payload) => {
  try {
    createAttachmentLifecycleEvent(payload);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error?.message || "invalid_attachment_lifecycle"] };
  }
};
const validateExecutionPayload = (payload) => domainResult(validateExecutionIdentity(payload));
const validateInteractionEnvelope = (envelope) => {
  const errors = [];
  const requestId = String(envelope?.payload?.requestId || "").trim();
  if (!String(envelope?.identity?.turnScopeId || "").trim()) errors.push("missing_turn_scope_id");
  if (envelope?.ordering?.domain !== INTERACTION_SEQUENCE_DOMAIN)
    errors.push("sequence_domain_mismatch");
  if (requestId && envelope?.ordering?.scopeId !== requestId)
    errors.push("sequence_scope_mismatch");
  return { valid: errors.length === 0, errors };
};
const validateMessageEnvelope = (envelope) => {
  const errors = [];
  const messageId = String(envelope?.identity?.messageId || "").trim();
  if (!messageId) errors.push("missing_message_id");
  if (envelope?.ordering?.domain !== MESSAGE_EVENT_SEQUENCE_DOMAIN) {
    errors.push("sequence_domain_mismatch");
  }
  if (messageId && envelope?.ordering?.scopeId !== messageId) {
    errors.push("sequence_scope_mismatch");
  }
  if (envelope?.payload?.eventType === MESSAGE_EVENT_TYPE.TURN_PRESENTATION_COMMITTED) {
    for (const role of ["user", "assistant"]) {
      const message = envelope?.payload?.presentation?.[`${role}Message`];
      if (
        String(message?.sessionId || "").trim() !==
        String(envelope?.identity?.sessionId || "").trim()
      ) {
        errors.push(`${role}_session_identity_mismatch`);
      }
      if (
        String(message?.turnScopeId || "").trim() !==
        String(envelope?.identity?.turnScopeId || "").trim()
      ) {
        errors.push(`${role}_turn_identity_mismatch`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
};

const descriptors = Object.freeze(
  [
    {
      family: EVENT_FAMILY.TURN_LIFECYCLE,
      wireEvents: [TURN_LIFECYCLE_WIRE_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.TURN,
      validatePayload: (payload) => domainResult(validateSessionEvent(payload)),
    },
    {
      family: EVENT_FAMILY.TURN_SNAPSHOT,
      wireEvents: [TURN_SNAPSHOT_WIRE_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.TURN,
      minimumSequence: 0,
      validateEnvelope: validateTurnSnapshotEnvelope,
      validatePayload: () => ({ valid: true, errors: [] }),
    },
    {
      family: EVENT_FAMILY.EXECUTION_LIFECYCLE,
      wireEvents: [EXECUTION_LIFECYCLE_WIRE_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.EXECUTION,
      validatePayload: validateExecutionPayload,
    },
    ...[
      [EVENT_FAMILY.EXECUTION_SNAPSHOT, EXECUTION_SNAPSHOT_WIRE_EVENT],
      [EVENT_FAMILY.EXECUTION_CHILDREN, EXECUTION_CHILDREN_WIRE_EVENT],
      [EVENT_FAMILY.EXECUTION_TREE, EXECUTION_TREE_WIRE_EVENT],
    ].map(([family, wireEvent]) => ({
      family,
      wireEvents: [wireEvent],
      reducerTarget: EVENT_REDUCER_TARGET.EXECUTION,
      validatePayload: validateExecutionPayload,
    })),
    {
      family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
      wireEvents: [ATTACHMENT_LIFECYCLE_WIRE_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.ATTACHMENT,
      validatePayload: validateAttachment,
    },
    {
      family: EVENT_FAMILY.INTERACTION_REQUEST,
      wireEvents: [INTERACTION_EVENT_TYPE.REQUEST],
      reducerTarget: EVENT_REDUCER_TARGET.INTERACTION,
      reducerInput: EVENT_REDUCER_INPUT.IDENTITY_PAYLOAD,
      validateEnvelope: validateInteractionEnvelope,
      validatePayload: (payload) => domainResult(validateInteractionRequestPayload(payload)),
    },
    {
      family: EVENT_FAMILY.INTERACTION_RESPONSE,
      wireEvents: [INTERACTION_EVENT_TYPE.RESPONSE],
      reducerTarget: EVENT_REDUCER_TARGET.INTERACTION,
      reducerInput: EVENT_REDUCER_INPUT.IDENTITY_PAYLOAD,
      validateEnvelope: validateInteractionEnvelope,
      validatePayload: (payload) => domainResult(validateInteractionResponsePayload(payload)),
    },
    {
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      wireEvents: [MESSAGE_EVENT_WIRE_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.MESSAGE,
      reducerInput: EVENT_REDUCER_INPUT.ENVELOPE,
      validateEnvelope: validateMessageEnvelope,
      validatePayload: (payload) => domainResult(validateMessageEventPayload(payload)),
    },
    {
      family: EVENT_FAMILY.WORKFLOW_RUNTIME,
      wireEvents: Object.values(WORKFLOW_RUNTIME_EVENT),
      reducerTarget: EVENT_REDUCER_TARGET.WORKFLOW,
      reducerInput: EVENT_REDUCER_INPUT.ENVELOPE,
      validateEnvelope: validateWorkflowRuntimeEnvelope,
      validatePayload: () => ({ valid: true, errors: [] }),
    },
  ].map((descriptor) =>
    Object.freeze({
      ...descriptor,
      authority: EVENT_AUTHORITY.AUTHORITATIVE,
      reducerInput: descriptor.reducerInput || EVENT_REDUCER_INPUT.PAYLOAD,
      minimumSequence: descriptor.minimumSequence ?? 1,
      wireEvents: Object.freeze(descriptor.wireEvents),
      replayable: true,
      persisted: true,
    }),
  ),
);
const byFamily = new Map(descriptors.map((descriptor) => [descriptor.family, descriptor]));
const byWireEvent = new Map(
  descriptors.flatMap((descriptor) =>
    descriptor.wireEvents.map((wireEvent) => [wireEvent, descriptor]),
  ),
);

export function getEventFamily(family = "") {
  return byFamily.get(String(family || "").trim()) || null;
}

export function readProtocolEventPayload(envelope = {}, { wireEvent = "", family = "" } = {}) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return { ...validation, payload: null };
  const expectedWireEvent = String(wireEvent || "").trim();
  if (expectedWireEvent && String(envelope.identity.eventType || "").trim() !== expectedWireEvent) {
    return {
      valid: false,
      errors: ["transport_event_identity_mismatch"],
      descriptor: validation.descriptor,
      payload: null,
    };
  }
  const expectedFamily = String(family || "").trim();
  if (expectedFamily && validation.descriptor.family !== expectedFamily) {
    return {
      valid: false,
      errors: ["event_family_mismatch"],
      descriptor: validation.descriptor,
      payload: null,
    };
  }
  return {
    valid: true,
    errors: [],
    descriptor: validation.descriptor,
    payload: envelope.payload,
  };
}

export function readProtocolEventReducerInput(envelope = {}) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return { ...validation, input: null };
  let input = envelope.payload;
  if (validation.descriptor.reducerInput === EVENT_REDUCER_INPUT.ENVELOPE) {
    input = envelope;
  } else if (validation.descriptor.reducerInput === EVENT_REDUCER_INPUT.IDENTITY_PAYLOAD) {
    input = {
      ...envelope.payload,
      sessionId: envelope.identity.sessionId,
      turnScopeId: envelope.identity.turnScopeId,
    };
  }
  return {
    valid: true,
    errors: [],
    descriptor: validation.descriptor,
    input,
  };
}
export function getEventFamilyByWireEvent(wireEvent = "") {
  return byWireEvent.get(String(wireEvent || "").trim()) || null;
}
export function listEventFamilies() {
  return [...descriptors];
}
export function validateProtocolEvent(envelope = {}) {
  const envelopeValidation = validateEventEnvelope(envelope);
  if (!envelopeValidation.valid) return { ...envelopeValidation, descriptor: null };
  const descriptor = getEventFamily(envelope.protocol.family);
  if (!descriptor) return { valid: false, errors: ["unsupported_event_family"], descriptor: null };
  if (!descriptor.wireEvents.includes(envelope.identity.eventType))
    return { valid: false, errors: ["event_type_family_mismatch"], descriptor };
  const orderingValidation =
    Number(envelope.ordering.sequence) < descriptor.minimumSequence
      ? { valid: false, errors: ["sequence_below_family_minimum"] }
      : { valid: true, errors: [] };
  const familyEnvelopeValidation = descriptor.validateEnvelope?.(envelope) || {
    valid: true,
    errors: [],
  };
  const payloadValidation = descriptor.validatePayload(envelope.payload);
  const errors = [
    ...orderingValidation.errors,
    ...familyEnvelopeValidation.errors,
    ...payloadValidation.errors,
  ];
  return { valid: errors.length === 0, errors, descriptor };
}
