import { describe, expect, it } from "vitest";
import { shouldProjectSubSessionEvent } from "../../../src/composables/chat/chatEngine/sendFlow";

describe("sendFlow sub-session message routing", () => {
  it("projects an authoritative child tool event without workflow node metadata", () => {
    expect(shouldProjectSubSessionEvent("subagent_message_event", {
      channelKind: "message_event",
      channelVersion: 1,
      route: { scope: "sub_session", sessionId: "042e2095-166a-4ff0-b1c3-daf18779a75c" },
      event: {
        envelopeKind: "noobot.message_event",
        envelopeVersion: 1,
        sessionId: "042e2095-166a-4ff0-b1c3-daf18779a75c",
        messageId: "msg_55f39303-4216-4103-b500-c98983a9eb1e",
        toolCallId: "call_rp9JoyKOqvVwNpAJUobrY6bU",
        eventType: "tool_call_end",
        eventId: "event-2",
        turnScopeId: "workflow-node:client-turn_mrtd4rir_0g704tsc_a1_1",
        sequence: 2,
        timestamp: "2026-07-21T00:00:00.000Z",
      },
    })).toBe(true);
  });

  it("does not project an unaddressed child lifecycle event", () => {
    expect(shouldProjectSubSessionEvent("subagent_event", {
      scope: "sub_session",
      sessionId: "child-session",
    })).toBe(false);
  });
});
