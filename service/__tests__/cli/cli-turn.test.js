/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AGENT_COMMAND, parseAgentCommand } from "@noobot/agent-transport-protocol";
import {
  TURN_EVENT,
  TURN_EVENT_PHASE,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_PHASE,
  createTurnLifecycleEnvelope,
  deriveTurnState,
} from "@noobot/session-protocol";
import {
  EVENT_FAMILY,
  INTERACTION_EVENT_TYPE,
  INTERACTION_SEQUENCE_DOMAIN,
  createEventEnvelope,
  createTurnLifecycleEventEnvelope,
  getEventFamily,
} from "@noobot/event-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
  MESSAGE_RUNTIME_PRODUCER,
  isTransientMessageEventType,
} from "@noobot/event-protocol/message-event";
import { CLI_ACTION, parseCliArgs } from "../../cli/cli-args.js";
import {
  buildInteractionResponse,
  classifyInteractionRequest,
} from "../../cli/interaction-prompt.js";
import { buildResult, createRenderer } from "../../cli/output.js";
import {
  buildRunCommand,
  CLI_EXIT_CODE,
  CLIENT_CLOSE_REASON,
  createCliTurnIdentity,
  runCliTurn,
  TURN_STATUS_REJECTED_REASON,
} from "../../cli/run-turn.js";
import { createTurnTracker, readCliTurnEvent, readMessageDelta } from "../../cli/turn-events.js";

const OCCURRED_AT = "2026-01-01T00:00:00.000Z";
const AGENT_PRODUCER = Object.freeze({ type: "agent", id: "agent-test" });
const FIXED_TURN = Object.freeze({
  sessionId: "s",
  turnScopeId: "t",
  presentationMessageId: "presentation-1",
});
let eventCounter = 0;
const nextEventId = (prefix) => `${prefix}-${(eventCounter += 1)}`;

function lifecycle(turn, eventType, revision, { phase = TURN_EVENT_PHASE[eventType] } = {}) {
  const completion =
    eventType === TURN_EVENT.COMPLETED || eventType === TURN_EVENT.STOP_COMPLETED
      ? { completionCommitId: `commit-${revision}`, summaryVersion: 1 }
      : {};
  const payload = createTurnLifecycleEnvelope({
    eventType,
    eventId: nextEventId("lifecycle"),
    commandId: `command-${revision}`,
    sessionId: turn.sessionId,
    parentSessionId: "",
    turnScopeId: turn.turnScopeId,
    presentationMessageId: turn.presentationMessageId,
    dialogProcessId: "dp-1",
    revision,
    sequence: revision,
    phase,
    state: deriveTurnState(eventType, phase),
    executionId: "ex-1",
    occurredAt: OCCURRED_AT,
    ...completion,
  });
  return {
    event: TURN_LIFECYCLE_WIRE_EVENT,
    data: createTurnLifecycleEventEnvelope(payload, { producer: AGENT_PRODUCER }),
  };
}

function message(turn, eventType, extra = {}, sequence = 1) {
  return {
    event: MESSAGE_EVENT_WIRE_EVENT,
    data: createEventEnvelope({
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
      identity: {
        eventId: nextEventId("message"),
        eventType: MESSAGE_EVENT_WIRE_EVENT,
        sessionId: turn.sessionId,
        turnScopeId: turn.turnScopeId,
      },
      causality: {},
      ordering: {
        domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
        scopeId: turn.presentationMessageId,
        sequence: isTransientMessageEventType(eventType) ? 0 : sequence,
      },
      producer: MESSAGE_RUNTIME_PRODUCER,
      occurredAt: OCCURRED_AT,
      payload: {
        eventType,
        presentationMessageId: turn.presentationMessageId,
        dialogProcessId: "dp-1",
        ...extra,
      },
    }),
  };
}

function interaction(turn, requestId) {
  return {
    event: INTERACTION_EVENT_TYPE.REQUEST,
    data: createEventEnvelope({
      family: EVENT_FAMILY.INTERACTION_REQUEST,
      schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
      identity: {
        eventId: nextEventId("interaction"),
        eventType: INTERACTION_EVENT_TYPE.REQUEST,
        sessionId: turn.sessionId,
        turnScopeId: turn.turnScopeId,
      },
      causality: {},
      ordering: { domain: INTERACTION_SEQUENCE_DOMAIN, scopeId: requestId, sequence: 1 },
      producer: AGENT_PRODUCER,
      occurredAt: OCCURRED_AT,
      payload: { requestId, dialogProcessId: "dp-1", lifecycle: "pending", content: "confirm?" },
    }),
  };
}

function read(packet) {
  const turnEvent = readCliTurnEvent(packet);
  assert.equal(turnEvent?.valid, true, turnEvent?.errors?.join(","));
  return turnEvent;
}

function sink() {
  let text = "";
  return { write: (chunk) => (text += chunk), isTTY: false, read: () => text };
}

function createFakeTransport(script, signalSource, turn) {
  const sent = [];
  return {
    sent,
    openConnection({ onEvent }) {
      let open = true;
      let resolveClosed;
      const closed = new Promise((resolve) => (resolveClosed = resolve));
      const connection = {
        closed,
        isOpen: () => open,
        send(command) {
          sent.push(command);
          setImmediate(() => script({ command, emit: onEvent, close, signalSource, turn }));
        },
        close: (reason) => close(reason, 1),
      };
      function close(reason, exitCode = 0) {
        if (!open) return;
        open = false;
        resolveClosed({ code: 1000, reason, exitCode });
      }
      return connection;
    },
  };
}

test("run command passes the shared protocol validation for send and continue", () => {
  assert.throws(() => createCliTurnIdentity({ sessionId: "" }), /cli_session_id_required/);
  const identity = createCliTurnIdentity({ sessionId: "session-new" });
  assert.match(identity.turnScopeId, /^cli-turn:/);
  const send = buildRunCommand({
    invocation: parseCliArgs(["hello"]),
    identity,
    attachments: [],
    aggregateVersion: 0,
    createSession: true,
  });
  assert.equal(parseAgentCommand(send).commandType, AGENT_COMMAND.SEND);
  assert.equal(send.session.createIfAbsent, true);
  const invocation = parseCliArgs([
    "resume-turn",
    "--resume",
    "s",
    "--dialog",
    "d",
    "--turn",
    "t",
    "go",
  ]);
  assert.equal(invocation.action, CLI_ACTION.RESUME_TURN);
  const cont = buildRunCommand({
    invocation,
    identity: createCliTurnIdentity({ sessionId: "s" }),
    attachments: [],
    aggregateVersion: 3,
    createSession: false,
  });
  assert.equal(parseAgentCommand(cont).commandType, AGENT_COMMAND.CONTINUE);
  assert.deepEqual(cont.continuation, { dialogProcessId: "d", turnScopeId: "t" });
});

test("tracker follows lifecycle revision and prefers authoritative final content", () => {
  const tracker = createTurnTracker({ sessionId: "s", turnScopeId: "t" });
  const apply = (packet) => tracker.apply(read(packet));
  apply(lifecycle(FIXED_TURN, TURN_EVENT.ACTION_ACCEPTED, 1));
  apply(message(FIXED_TURN, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "he" }));
  apply(message(FIXED_TURN, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "llo" }));
  assert.equal(tracker.content(), "hello");
  apply(message(FIXED_TURN, MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT, { text: "final" }));
  apply(lifecycle(FIXED_TURN, TURN_EVENT.COMPLETED, 3));
  assert.equal(tracker.content(), "final");
  apply(message(FIXED_TURN, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: " late" }));
  assert.equal(tracker.content(), "final");
  assert.equal(tracker.state.revision, 3);
  assert.equal(tracker.state.terminal, true);
  apply(
    lifecycle({ ...FIXED_TURN, turnScopeId: "other" }, TURN_EVENT.FAILED, 9, {
      phase: TURN_PHASE.PROCESSING,
    }),
  );
  assert.equal(tracker.state.revision, 3);
});

test("tracker ignores activity deltas which belong to the activity timeline", () => {
  const tracker = createTurnTracker({ sessionId: "s", turnScopeId: "t" });
  const activity = read(
    message(FIXED_TURN, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA, {
      text: "analysis",
      activityId: "activity-1",
      activityKind: "main_model_analysis",
      activityEventType: MESSAGE_EVENT_TYPE.THINKING,
    }),
  );
  tracker.apply(activity);
  assert.equal(tracker.content(), "");
  assert.equal(readMessageDelta(activity), null);
});

test("cli entry rejects protocol events which fail family validation", () => {
  const rejected = readCliTurnEvent(
    message(FIXED_TURN, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: undefined }),
  );
  assert.equal(rejected.valid, false);
  assert.deepEqual([...rejected.errors], ["missing_text"]);
  assert.equal(readCliTurnEvent({ event: "unrelated", data: {} }), null);
});

test("interaction classification and response shapes", () => {
  assert.equal(classifyInteractionRequest({ lifecycle: "resolved" }).kind, "ignore");
  assert.equal(classifyInteractionRequest({}, { allowInteraction: false }).kind, "unavailable");
  assert.equal(
    classifyInteractionRequest({ requireEncryption: true }, { allowInteraction: true }).reason,
    "interaction_encryption_required",
  );
  assert.equal(classifyInteractionRequest({}, { allowInteraction: true }).kind, "answer");
  assert.deepEqual(buildInteractionResponse({ confirmed: false }), {
    confirmed: false,
    response: "",
  });
  assert.deepEqual(
    buildInteractionResponse({ fields: [{ name: "a" }], answers: { a: "1", b: "x" } }),
    { confirmed: true, a: "1" },
  );
});

test("text renderer streams deltas and stream-json passes packets verbatim", () => {
  const out = sink();
  const err = sink();
  const text = createRenderer("text", { stdout: out, stderr: err });
  const delta = message(FIXED_TURN, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: "hi" });
  text.event(delta, read(delta));
  const toolStart = message(FIXED_TURN, MESSAGE_EVENT_TYPE.TOOL_CALL_START, {
    tool: "read_file",
    toolCallId: "call-1",
    args: { filePath: "example.txt", riskLevel: "low" },
  });
  text.event(toolStart, read(toolStart));
  text.result({ content: "hi", exitCode: 0 });
  assert.equal(out.read(), "hi\n");
  assert.match(err.read(), /\[tool\] read_file/);

  const ndjson = sink();
  const stream = createRenderer("stream-json", { stdout: ndjson, stderr: sink() });
  const packet = lifecycle(FIXED_TURN, TURN_EVENT.ACTION_ACCEPTED, 1);
  stream.event(packet, read(packet));
  stream.result({ status: "done" });
  const lines = ndjson
    .read()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], JSON.parse(JSON.stringify(packet)));
  assert.deepEqual(lines[1], { type: "result", status: "done" });
});

async function runScripted(script, options = {}) {
  const signalSource = new EventEmitter();
  const identity = createCliTurnIdentity({ sessionId: "session-cli" });
  const transport = createFakeTransport(script, signalSource, {
    sessionId: identity.sessionId,
    turnScopeId: identity.turnScopeId,
    presentationMessageId: identity.presentationMessageId,
  });
  const command = buildRunCommand({
    invocation: parseCliArgs(["hello"]),
    identity,
    attachments: [],
    aggregateVersion: 0,
    createSession: true,
  });
  const promise = runCliTurn({
    transport,
    authInfo: { userId: "admin" },
    command,
    identity,
    renderer: createRenderer("json", { stdout: sink(), stderr: sink() }),
    askInteraction: async () => ({ confirmed: true, response: "ok" }),
    signalSource,
    ...options,
  });
  return { transport, signalSource, promise };
}

test("completed turn returns the service exit code and content", async () => {
  const { promise } = await runScripted(({ command, emit, close, turn }) => {
    if (command.commandType !== AGENT_COMMAND.SEND) return;
    emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 1));
    emit(message(turn, MESSAGE_EVENT_TYPE.AUTHORITATIVE_FINAL_CONTENT, { text: "answer" }));
    emit(lifecycle(turn, TURN_EVENT.COMPLETED, 2));
    close("done", 0);
  });
  const run = await promise;
  assert.equal(run.exitCode, CLI_EXIT_CODE.DONE);
  assert.equal(buildResult(run).content, "answer");
  assert.equal(buildResult(run).dialogProcessId, "dp-1");
});

test("invalid protocol event closes the turn with a client rejection reason", async () => {
  const { promise } = await runScripted(({ command, emit, turn }) => {
    if (command.commandType !== AGENT_COMMAND.SEND) return;
    emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 1));
    emit(message(turn, MESSAGE_EVENT_TYPE.LLM_DELTA, { text: undefined }));
  });
  const run = await promise;
  assert.equal(run.outcome.reason, CLIENT_CLOSE_REASON.PROTOCOL_EVENT_REJECTED);
});

test("Ctrl-C after acceptance sends turn.stop with the latest revision", async () => {
  const { transport, promise } = await runScripted(
    ({ command, emit, close, signalSource, turn }) => {
      if (command.commandType === AGENT_COMMAND.SEND) {
        emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 2));
        setImmediate(() => signalSource.emit("SIGINT"));
      } else if (command.commandType === AGENT_COMMAND.STOP) {
        emit(lifecycle(turn, TURN_EVENT.STOP_COMPLETED, 4));
        close("user_stopped", 130);
      }
    },
  );
  const run = await promise;
  const stop = transport.sent.find((item) => item.commandType === AGENT_COMMAND.STOP);
  assert.equal(stop.concurrency.expectedTurnRevision, 2);
  assert.equal(Object.hasOwn(stop.identity, "dialogProcessId"), false);
  assert.equal(stop.stop.executionId, "ex-1");
  assert.equal(run.exitCode, CLI_EXIT_CODE.STOPPED);
});

test("status persistence failure is retryable only before acceptance", async () => {
  const rejectedBefore = await (
    await runScripted(({ close }) => close(TURN_STATUS_REJECTED_REASON, 2))
  ).promise;
  assert.equal(rejectedBefore.rejected, true);
  const rejectedAfter = await (
    await runScripted(({ command, emit, close, turn }) => {
      if (command.commandType !== AGENT_COMMAND.SEND) return;
      emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 1));
      close(TURN_STATUS_REJECTED_REASON, 2);
    })
  ).promise;
  assert.equal(rejectedAfter.rejected, false);
});

test("Ctrl-C before acceptance closes locally with a client reason", async () => {
  const { transport, promise } = await runScripted(({ signalSource }) => {
    setImmediate(() => signalSource.emit("SIGINT"));
  });
  const run = await promise;
  assert.equal(run.outcome.reason, CLIENT_CLOSE_REASON.INTERRUPTED);
  assert.equal(run.exitCode, CLI_EXIT_CODE.STOPPED);
  assert.equal(
    transport.sent.some((item) => item.commandType === AGENT_COMMAND.STOP),
    false,
  );
});

test("interaction is answered with interaction.response; unavailable stops with exit 3", async () => {
  const answered = await runScripted(
    ({ command, emit, close, turn }) => {
      if (command.commandType === AGENT_COMMAND.SEND) {
        emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 1));
        emit(interaction(turn, "r1"));
      } else if (command.commandType === AGENT_COMMAND.INTERACTION_RESPONSE) {
        close("done", 0);
      }
    },
    { allowInteraction: true },
  );
  await answered.promise;
  const response = answered.transport.sent.find(
    (item) => item.commandType === AGENT_COMMAND.INTERACTION_RESPONSE,
  );
  assert.equal(response.commandId, "interaction:r1");
  assert.deepEqual(response.interaction, {
    requestId: "r1",
    response: { confirmed: true, response: "ok" },
  });

  const blocked = await runScripted(({ command, emit, close, turn }) => {
    if (command.commandType === AGENT_COMMAND.SEND) {
      emit(lifecycle(turn, TURN_EVENT.ACTION_ACCEPTED, 1));
      emit(interaction(turn, "r1"));
    } else if (command.commandType === AGENT_COMMAND.STOP) {
      close("user_stopped", 130);
    }
  });
  const run = await blocked.promise;
  assert.equal(run.exitCode, CLI_EXIT_CODE.INTERACTION_UNAVAILABLE);
});
