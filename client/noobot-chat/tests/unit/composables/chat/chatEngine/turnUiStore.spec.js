import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionTurnUiStates,
  clearTurnUiState,
  getTurnUiState,
  promoteSessionTurnUiStates,
  setTurnThinkingOpenNames,
  toggleTurnDetailKey,
} from "../../../../../src/composables/chat/chatEngine/turnUiStore";
import { hydrateTurnSnapshot } from "../../../../../src/composables/chat/chatEngine/turnProjectionStore";

const turn = (sessionId, turnScopeId) => ({ sessionId, turnScopeId });

describe("turnUiStore lifecycle", () => {
  afterEach(() => {
    clearSessionTurnUiStates("session-a");
    clearSessionTurnUiStates("session-b");
    clearSessionTurnUiStates("session-canonical");
  });

  it("isolates turns while preserving repeated access to the same turn", () => {
    const first = turn("session-a", "turn-1");
    const second = turn("session-a", "turn-2");
    setTurnThinkingOpenNames(first, ["tools"]);
    toggleTurnDetailKey(first, "call-1");

    expect(getTurnUiState(first)).toBe(getTurnUiState(first));
    expect(getTurnUiState(first)).toMatchObject({
      thinkingOpenNames: ["tools"],
      expandedDetailLogKeys: ["call-1"],
    });
    expect(getTurnUiState(second)).toMatchObject({
      thinkingOpenNames: [],
      expandedDetailLogKeys: [],
    });
  });

  it("clears one turn without affecting sibling turns", () => {
    const first = turn("session-a", "turn-1");
    const second = turn("session-a", "turn-2");
    getTurnUiState(first).selectedToolKey = "tool-1";
    getTurnUiState(second).selectedToolKey = "tool-2";
    clearTurnUiState(first);

    expect(getTurnUiState(first).selectedToolKey).toBe("");
    expect(getTurnUiState(second).selectedToolKey).toBe("tool-2");
  });

  it("clears every turn owned by a session", () => {
    getTurnUiState(turn("session-a", "turn-1")).scrollTop = 10;
    getTurnUiState(turn("session-a", "turn-2")).scrollTop = 20;
    getTurnUiState(turn("session-b", "turn-1")).scrollTop = 30;

    expect(clearSessionTurnUiStates("session-a")).toBe(2);
    expect(getTurnUiState(turn("session-a", "turn-1")).scrollTop).toBe(0);
    expect(getTurnUiState(turn("session-b", "turn-1")).scrollTop).toBe(30);
  });

  it("promotes optimistic session UI state without leaking it to another turn", () => {
    const local = turn("session-a", "turn-1");
    getTurnUiState(local).animationKeys = ["analysis-1"];

    expect(promoteSessionTurnUiStates("session-a", "session-canonical")).toBe(1);
    expect(getTurnUiState(turn("session-canonical", "turn-1")).animationKeys).toEqual(["analysis-1"]);
    expect(getTurnUiState(local).animationKeys).toEqual([]);
    expect(getTurnUiState(turn("session-canonical", "turn-2")).animationKeys).toEqual([]);
  });

  it("keeps UI state outside versioned domain snapshot hydration", () => {
    const identity = turn("session-a", "turn-1");
    const targetMessage = { ...identity, content: "live" };
    const ui = getTurnUiState(identity);
    ui.thinkingOpenNames = ["activity"];
    ui.scrollTop = 88;

    expect(hydrateTurnSnapshot({
      targetMessage,
      throughSequence: 2,
      snapshot: {
        ...identity,
        content: "snapshot",
        thinkingOpenNames: ["must-not-enter-ui-store"],
        scrollTop: 0,
        messageEventState: { lastSequence: 2, consumedEventIds: [] },
      },
    }).applied).toBe(true);
    expect(getTurnUiState(identity)).toMatchObject({ thinkingOpenNames: ["activity"], scrollTop: 88 });
  });
});
