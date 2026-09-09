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
  validateSessionEvent,
} from "@noobot/session-protocol";
import { ATTACHMENT_LIFECYCLE_WIRE_EVENT } from "@noobot/attachment-protocol";
import { validateEventEnvelope } from "./envelope.js";
import {
  INTERACTION_EVENT_TYPE,
  validateInteractionRequestPayload,
  validateInteractionResponsePayload,
} from "./interaction.js";
import { MESSAGE_EVENT_WIRE_EVENT, validateMessageEventPayload } from "./message-event.js";
import {
  domainResult,
  validateAttachment,
  validateExecutionPayload,
  validateInteractionEnvelope,
  validateMessageEnvelope,
} from "./event-registry-validators.js";
import { text } from "./normalize.js";
import {
  validateWorkflowRuntimeEnvelope,
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_RUNTIME_FAMILY,
} from "./workflow-runtime-event.js";
import { TURN_SNAPSHOT_EVENT_FAMILY, validateTurnSnapshotEnvelope } from "./turn-snapshot.js";
import {
  PLUGIN_ARTIFACT_EVENT,
  PLUGIN_ARTIFACT_FAMILY,
  validatePluginArtifactEnvelope,
} from "./plugin-artifact-event.js";

export const EVENT_AUTHORITY = Object.freeze({ AUTHORITATIVE: "authoritative" });
export const EVENT_REDUCER_TARGET = Object.freeze({
  TURN: "turn",
  EXECUTION: "execution",
  ATTACHMENT: "attachment",
  INTERACTION: "interaction",
  MESSAGE: "message",
  WORKFLOW: "workflow",
  PLUGIN_ARTIFACT: "plugin_artifact",
});
export const EVENT_REDUCER_INPUT = Object.freeze({
  ENVELOPE: "envelope",
  IDENTITY_PAYLOAD: "identity_payload",
  PAYLOAD: "payload",
});
export const EVENT_FAMILY = Object.freeze({
  TURN_LIFECYCLE: "turn.lifecycle",
  TURN_SNAPSHOT: TURN_SNAPSHOT_EVENT_FAMILY,
  EXECUTION_LIFECYCLE: "execution.lifecycle",
  EXECUTION_SNAPSHOT: "execution.snapshot",
  EXECUTION_CHILDREN: "execution.children",
  EXECUTION_TREE: "execution.tree",
  ATTACHMENT_LIFECYCLE: "attachment.lifecycle",
  INTERACTION_REQUEST: "interaction.request",
  INTERACTION_RESPONSE: "interaction.response",
  MESSAGE_TIMELINE: "message.timeline",
  WORKFLOW_RUNTIME: WORKFLOW_RUNTIME_FAMILY,
  PLUGIN_ARTIFACT: PLUGIN_ARTIFACT_FAMILY,
});

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
    {
      family: EVENT_FAMILY.PLUGIN_ARTIFACT,
      wireEvents: [PLUGIN_ARTIFACT_EVENT],
      reducerTarget: EVENT_REDUCER_TARGET.PLUGIN_ARTIFACT,
      reducerInput: EVENT_REDUCER_INPUT.ENVELOPE,
      validateEnvelope: validatePluginArtifactEnvelope,
      validatePayload: () => ({ valid: true, errors: [] }),
      sessionArtifact: true,
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
  return byFamily.get(text(family)) || null;
}

export function readProtocolEventPayload(envelope = {}, { wireEvent = "", family = "" } = {}) {
  const validation = validateProtocolEvent(envelope);
  if (!validation.valid) return { ...validation, payload: null };
  const expectedWireEvent = text(wireEvent);
  if (expectedWireEvent && text(envelope.identity.eventType) !== expectedWireEvent) {
    return {
      valid: false,
      errors: ["transport_event_identity_mismatch"],
      descriptor: validation.descriptor,
      payload: null,
    };
  }
  const expectedFamily = text(family);
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
  return byWireEvent.get(text(wireEvent)) || null;
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
