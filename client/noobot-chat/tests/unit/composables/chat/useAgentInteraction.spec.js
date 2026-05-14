import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAgentInteraction } from "../../../../src/composables/chat/useAgentInteraction";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key) => key,
  }),
}));

describe("useAgentInteraction", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("deduplicates replayed interaction by requestId after handled", () => {
    const sendJson = vi.fn();
    const interaction = useAgentInteraction({
      encryptPayloadBySessionId: (payload) => payload,
      sendJson,
    });
    const request = { requestId: "req-1", sessionId: "s-1" };

    interaction.setPendingInteractionRequest(request);
    expect(interaction.pendingInteractionRequest.value?.requestId).toBe("req-1");

    interaction.submitInteractionResponse({ ok: true });
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(interaction.pendingInteractionRequest.value).toBeNull();
    expect(interaction.isInteractionRequestHandled("req-1")).toBe(true);

    interaction.setPendingInteractionRequest(request);
    expect(interaction.pendingInteractionRequest.value).toBeNull();
  });

  it("deduplicates by signature when requestId is missing", () => {
    const interaction = useAgentInteraction({
      encryptPayloadBySessionId: (payload) => payload,
      sendJson: vi.fn(),
    });
    const requestNoId = {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      interactionType: "confirm",
      toolName: "toolA",
      connectorType: "terminal",
      connectorName: "local",
      content: "continue?",
    };

    interaction.markInteractionRequestHandled(requestNoId);
    expect(interaction.isInteractionRequestHandled(requestNoId)).toBe(true);

    interaction.setPendingInteractionRequest(requestNoId);
    expect(interaction.pendingInteractionRequest.value).toBeNull();
  });

  it("submitInteractionResponse sends encrypted payload and toggles state", () => {
    const sendJson = vi.fn();
    const encryptPayloadBySessionId = vi.fn(() => "encrypted-payload");
    const interaction = useAgentInteraction({
      encryptPayloadBySessionId,
      sendJson,
    });

    interaction.setPendingInteractionRequest({
      requestId: "req-2",
      sessionId: "session-2",
      requireEncryption: true,
    });
    interaction.submitInteractionResponse({ approved: true });

    expect(encryptPayloadBySessionId).toHaveBeenCalledWith({ approved: true }, "session-2");
    expect(sendJson).toHaveBeenCalledWith({
      action: "interaction_response",
      requestId: "req-2",
      response: {
        encrypted: true,
        payload: "encrypted-payload",
      },
    });
    expect(interaction.interactionSubmitting.value).toBe(false);
    expect(interaction.pendingInteractionRequest.value).toBeNull();
  });
});
