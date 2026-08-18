/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { classifyRealtimeLog } from "../../../../../../src/modules/chat/runtime/engine/realtimeLogClassifier.js";
import {
  MESSAGE_EVENT_REDUCE_RESULT,
  reduceMessageEvent,
} from "../../../../../../src/modules/chat/runtime/engine/messageEventReducer.js";
import {
  selectCompletedToolArtifacts,
  selectToolTimeline,
  selectToolTimelineLogs,
} from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  createSecurityAssessment,
  raiseSecurityAssessment,
} from "@noobot/security-assessment-protocol";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

function event(overrides = {}) {
  return canonicalMessageEvent(overrides);
}

function message(overrides = {}) {
  return {
    id: "message-1",
    messageId: "message-1",
    turnScopeId: "turn-1",
    content: "",
    realtimeLogs: [],
    ...overrides,
  };
}

const reduce = (targetMessage, envelope) =>
  reduceMessageEvent({ targetMessage, event: envelope, classifyRealtimeLog });

describe("reduceMessageEvent", () => {
  it("applies text and no-text tool lifecycle events", () => {
    const target = message();
    expect(reduce(target, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(selectToolTimelineLogs(target)[0]).toMatchObject({
      type: "tool_call",
      toolCallId: "call-1",
      args: {},
      detailText: "{}",
    });
    expect(
      reduce(
        target,
        event({
          eventId: "evt-2",
          eventType: "tool_call_end",
          sequence: 2,
          result: { ok: true },
          success: true,
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(selectToolTimelineLogs(target)[1]).toMatchObject({
      type: "tool_result",
      result: { ok: true },
      detailText: '{\n  "ok": true\n}',
    });
    expect(selectToolTimeline(target)).toHaveLength(1);
    expect(
      reduce(
        target,
        event({ eventId: "evt-3", eventType: "llm_delta", sequence: 3, text: "hello" }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(target.content).toBe("hello");
  });

  it("preserves a failed tool result as failed in the timeline", () => {
    const target = message();
    reduce(target, event());
    reduce(
      target,
      event({
        eventId: "evt-failed",
        eventType: "tool_call_end",
        sequence: 2,
        result: { ok: false, error: "not found" },
        success: false,
      }),
    );

    expect(selectToolTimeline(target)[0]).toMatchObject({ success: false, status: "failed" });
    expect(selectToolTimelineLogs(target)[1]).toMatchObject({
      success: false,
      status: "failed",
      presentation: { tone: "error" },
    });
  });

  it("projects object file references through one display protocol", () => {
    const target = message();
    reduce(
      target,
      event({
        args: {
          filePath: {
            view: "attachment",
            identity: {
              attachmentId: "att-live-file",
              sessionId: "session-1",
              attachmentSource: "user",
            },
          },
        },
      }),
    );

    expect(selectToolTimelineLogs(target)[0].text).toBe("read_file · attachment:att-live-file");
  });

  it("uses the canonical presentation protocol for patch and native script summaries", () => {
    const target = message({
      toolTimeline: [
        {
          key: "call:patch-summary",
          toolCallId: "patch-summary",
          tool: "patch_file",
          args: { format: "apply_patch", dryRun: true, patch: "*** Begin Patch" },
          call: {
            eventId: "evt-patch-summary",
            sequence: 1,
          },
        },
        {
          key: "call:native-summary",
          toolCallId: "native-summary",
          tool: "execute_native_script",
          args: { inputs: [{ source: "notes.txt" }], arguments: { phase: "probe" } },
          result: {
            ok: true,
            output_file_count: 1,
            output_bytes: 10,
            transferEnvelopes: [{ payload: { attachments: [{ name: "result.txt" }] } }],
          },
          call: { eventId: "evt-native-call", sequence: 2 },
          resultEvent: { eventId: "evt-native-result", sequence: 3 },
        },
      ],
    });

    expect(selectToolTimelineLogs(target).map((item) => item.text)).toEqual([
      "patch_file · apply_patch · dry-run",
      "execute_native_script · 1 input · phase=probe",
      "execute_native_script · result.txt · 10 B",
    ]);
  });

  it("replaces declared risk with the authoritative server-assessed risk", () => {
    const target = message();
    const initialAssessment = createSecurityAssessment({
      toolName: "write_file",
      args: { riskLevel: "low" },
    });
    const raisedAssessment = raiseSecurityAssessment(initialAssessment, {
      source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
      riskLevel: "high",
    });
    reduce(
      target,
      event({
        eventId: "evt-risk-call",
        eventType: "tool_call_start",
        sequence: 1,
        tool: "write_file",
        toolCallId: "call-risk",
        args: { filePath: "notes.txt", riskLevel: "low" },
        riskLevel: initialAssessment.effectiveRiskLevel,
        securityAssessment: initialAssessment,
      }),
    );
    reduce(
      target,
      event({
        eventId: "evt-risk-result",
        eventType: "tool_call_end",
        sequence: 2,
        tool: "write_file",
        toolCallId: "call-risk",
        result: { ok: true },
        success: true,
        riskLevel: "high",
        securityAssessment: raisedAssessment,
      }),
    );

    expect(selectToolTimelineLogs(target).map((item) => item.riskLevel)).toEqual(["high", "high"]);
  });

  it("projects search overflow transfer attachments during live tool events", () => {
    const target = message({ sessionId: "session-1", attachments: [] });
    const transferEnvelope = {
      protocol: "noobot.semantic-transfer",
      version: 2,
      transferId: "transfer-search-overflow",
      messageId: "message-1",
      identity: {
        sessionId: "session-1",
        turnScopeId: "turn-1",
        runId: "run-1",
        producer: { type: "tool", id: "call-1" },
      },
      direction: "output",
      payload: {
        mode: "attachment",
        attachments: [
          {
            identity: {
              attachmentId: "att-search-result",
              sessionId: "session-1",
              attachmentSource: "model",
            },
            role: "primary",
            name: "search.result.txt",
            mimeType: "text/plain",
            size: 1301812,
          },
        ],
      },
      intent: {
        source: "tool",
        reason: "tool_result_overflow",
        scenario: "tool",
        strategy: "tool_result_text",
      },
      meta: {},
    };

    expect(
      reduce(
        target,
        event({
          eventId: "evt-search-overflow",
          eventType: "tool_call_end",
          sequence: 1,
          tool: "search",
          result: { ok: true, overflowed: true },
          success: true,
          transferEnvelopes: [transferEnvelope],
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);

    expect(target.transferEnvelopes).toEqual([transferEnvelope]);
    expect(target.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-search-result",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "search.result.txt",
        mimeType: "text/plain",
        size: 1301812,
        transferId: "transfer-search-overflow",
      }),
    ]);

    expect(
      reduce(
        target,
        event({
          eventId: "evt-search-final",
          eventType: "authoritative_final_content",
          sequence: 2,
          text: "search complete",
          transferEnvelopes: [transferEnvelope],
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(target.content).toBe("search complete");
    expect(target.attachments).toEqual([
      expect.objectContaining({
        attachmentId: "att-search-result",
        transferId: "transfer-search-overflow",
      }),
    ]);
  });

  it("projects persisted timeline entry detail through the same selector as live events", () => {
    const target = message({
      toolTimeline: [
        {
          key: "call:call-persisted",
          toolCallId: "call-persisted",
          tool: "execute_script",
          args: { command: "npm test" },
          result: { ok: true, exitCode: 0 },
          call: {
            sequence: 1,
            sequenceScopeId: "source-message-1",
            authority: "authoritative",
            sequenceDomain: "message-event",
            log: { event: "tool_call", type: "tool_call", text: "execute_script" },
          },
          resultEvent: {
            sequence: 2,
            sequenceScopeId: "source-message-1",
            authority: "authoritative",
            sequenceDomain: "message-event",
            log: { event: "tool_result", type: "tool_result", text: "execute_script" },
          },
        },
      ],
    });

    expect(selectToolTimelineLogs(target)).toEqual([
      expect.objectContaining({
        toolCallId: "call-persisted",
        tool: "execute_script",
        args: { command: "npm test" },
        detailText: '{\n  "command": "npm test"\n}',
      }),
      expect.objectContaining({
        toolCallId: "call-persisted",
        tool: "execute_script",
        result: { ok: true, exitCode: 0 },
        detailText: '{\n  "ok": true,\n  "exitCode": 0\n}',
        presentation: { tone: "success" },
      }),
    ]);
  });

  it("returns observable idempotency and sequence outcomes", () => {
    const target = message();
    reduce(target, event());
    expect(reduce(target, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.DUPLICATE);
    expect(reduce(target, event({ eventId: "evt-stale", sequence: 1 })).result).toBe(
      MESSAGE_EVENT_REDUCE_RESULT.STALE,
    );
    expect(reduce(target, event({ eventId: "evt-gap", sequence: 3 })).result).toBe(
      MESSAGE_EVENT_REDUCE_RESULT.SEQUENCE_GAP,
    );
  });

  it("converges streamed deltas and non-streamed final content to the same projection", () => {
    const streamed = message({ pending: true });
    reduce(
      streamed,
      event({ eventId: "evt-1", eventType: "llm_delta", sequence: 1, text: "draft " }),
    );
    reduce(
      streamed,
      event({ eventId: "evt-2", eventType: "llm_delta", sequence: 2, text: "tokens" }),
    );
    reduce(
      streamed,
      event({
        eventId: "evt-3",
        eventType: "authoritative_final_content",
        sequence: 3,
        text: "authoritative final",
      }),
    );

    const nonStreamed = message({ pending: true });
    reduce(
      nonStreamed,
      event({
        eventId: "evt-final",
        eventType: "authoritative_final_content",
        sequence: 1,
        text: "authoritative final",
      }),
    );

    expect(streamed.content).toBe("authoritative final");
    expect(nonStreamed.content).toBe(streamed.content);
    expect(streamed.messageEventState.finalContentSequence).toBe(3);
    expect(nonStreamed.messageEventState.finalContentSequence).toBe(1);
    expect(streamed.hasFirstStreamEvent).toBe(true);
    expect(nonStreamed.hasFirstStreamEvent).toBe(true);
    expect(streamed.pending).toBe(true);
    expect(nonStreamed.pending).toBe(true);
  });

  it("atomically replaces final content, attachments and semantic transfers", () => {
    const target = message({
      content: "draft",
      attachments: [{ attachmentId: "stale" }],
      transferEnvelopes: [],
    });
    const attachments = [
      {
        identity: {
          attachmentId: "att-final",
          sessionId: "session-1",
          attachmentSource: "test",
        },
        attachmentId: "att-final",
        sessionId: "session-1",
        attachmentSource: "test",
        name: "final.md",
      },
    ];
    const transferEnvelopes = [
      {
        protocol: "noobot.semantic-transfer",
        version: 2,
        transferId: "transfer-final",
        messageId: "message-final",
        identity: {
          sessionId: "session-1",
          turnScopeId: "turn-1",
          runId: "run-1",
          producer: { type: "tool", id: "call-final" },
        },
        direction: "output",
        payload: {
          mode: "attachment",
          attachments: [
            {
              identity: {
                attachmentId: "att-final",
                sessionId: "session-1",
                attachmentSource: "test",
              },
              role: "primary",
              name: "final.md",
            },
          ],
        },
        intent: {
          source: "tool",
          reason: "semantic_transfer_tool_result",
          scenario: "tool",
          strategy: "tool_result_text",
        },
        meta: {},
      },
    ];

    expect(
      reduce(
        target,
        event({
          eventId: "evt-final-payload",
          eventType: "authoritative_final_content",
          text: "complete final",
          attachments,
          transferEnvelopes,
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);

    expect(target).toMatchObject({ content: "complete final", attachments, transferEnvelopes });
  });

  it("does not project tool implementation paths as completed artifacts", () => {
    const target = message({ pending: true });
    reduce(target, event());
    reduce(
      target,
      event({
        eventId: "evt-tool-end",
        eventType: "tool_call_end",
        sequence: 2,
        result: { ok: true },
        success: true,
        writtenFiles: [
          {
            toolName: "write_file",
            resolvedPath: "/workspace/admin/runtime/ops_workdir/write_test.txt",
            fileName: "write_test.txt",
            isSandbox: true,
          },
        ],
      }),
    );
    reduce(
      target,
      event({
        eventId: "evt-final",
        eventType: "authoritative_final_content",
        sequence: 3,
        text: "done",
      }),
    );

    expect(target.pending).toBe(true);
    expect(target.hasFirstStreamEvent).toBe(true);
    expect(selectCompletedToolArtifacts(target)).toEqual(
      expect.objectContaining({
        resultCount: 1,
        attachments: [],
      }),
    );
    expect(selectCompletedToolArtifacts(target)).not.toHaveProperty("writtenFiles");
  });

  it("only exposes tool result attachments with the canonical identity triple", () => {
    const artifacts = selectCompletedToolArtifacts({
      toolTimeline: [
        {
          resultEvent: {
            attachments: [
              { name: "stdout.txt", path: "/tmp/stdout.txt" },
              {
                attachmentId: "attachment-1",
                sessionId: "session-1",
                attachmentSource: "model",
                name: "result.json",
              },
            ],
          },
        },
      ],
    });

    expect(artifacts.attachments).toEqual([
      expect.objectContaining({ attachmentId: "attachment-1" }),
    ]);
  });

  it("keeps authoritative final content immutable against later deltas", () => {
    const target = message();
    expect(
      reduce(
        target,
        event({
          eventId: "evt-final",
          eventType: "authoritative_final_content",
          sequence: 1,
          text: "authoritative final",
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);

    expect(
      reduce(
        target,
        event({
          eventId: "evt-late-delta",
          eventType: "llm_delta",
          sequence: 2,
          text: " late",
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.FINAL_CONTENT_LOCKED);
    expect(target.content).toBe("authoritative final");
    expect(target.messageEventState.finalContentSequence).toBe(1);
    expect(target.messageEventState.lastSequence).toBe(1);
  });

  it("rejects invalid, missing targets and identity conflicts", () => {
    expect(reduce(null, event()).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.TARGET_MISSING);
    expect(reduce(message(), event({ toolCallId: "" })).result).toBe(
      MESSAGE_EVENT_REDUCE_RESULT.INVALID,
    );
    expect(reduce(message({ id: "other", messageId: "other" }), event()).result).toBe(
      MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT,
    );
  });

  it("validates the explicit presentation identity independently from the source message", () => {
    const target = message({ id: "presentation-1", messageId: "presentation-1" });
    const projected = event({
      messageId: "model-message-1",
      presentationMessageId: "presentation-1",
    });
    expect(reduce(target, projected).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(
      reduce(
        message(),
        event({
          eventId: "evt-conflict",
          messageId: "model-message-1",
          presentationMessageId: "presentation-1",
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.MESSAGE_IDENTITY_CONFLICT);
  });

  it("keeps guidance and model analysis on the same presentation activity timeline", () => {
    const target = message({ id: "presentation-1", messageId: "presentation-1" });
    expect(
      reduce(
        target,
        event({
          eventId: "evt-guidance-analysis",
          eventType: "thinking",
          event: "guidance_analysis_response",
          type: "guidance_analysis",
          purpose: "guidance",
          pluginFlow: "analysis",
          chain: "auxiliary",
          messageId: "model-message-1",
          presentationMessageId: "presentation-1",
          sequenceScopeId: "model-message-1",
          tool: "",
          toolCallId: "",
          args: undefined,
          text: "guidance analysis",
        }),
      ).result,
    ).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    const projected = event({
      eventId: "evt-model-analysis",
      sequence: 2,
      eventType: "main_model_content",
      messageId: "model-message-1",
      presentationMessageId: "presentation-1",
      tool: "",
      toolCallId: "",
      args: undefined,
      text: "intermediate model analysis",
    });

    expect(reduce(target, projected).result).toBe(MESSAGE_EVENT_REDUCE_RESULT.APPLIED);
    expect(target.content).toBe("");
    expect(target.activityTimeline).toHaveLength(2);
    expect(selectActivityTimelineLogs(target)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "guidance_analysis_response",
          text: "guidance analysis",
        }),
        expect.objectContaining({
          event: "main_model_content",
          text: "intermediate model analysis",
          messageId: "model-message-1",
          presentationMessageId: "presentation-1",
        }),
      ]),
    );
  });
});
