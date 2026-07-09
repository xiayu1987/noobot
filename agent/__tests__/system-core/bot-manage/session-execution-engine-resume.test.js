import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";

test("_prepareStoppedSnapshotResumeTurnExecution requires explicit stopped snapshot identity", async () => {
  const engine = Object.create(SessionExecutionEngine.prototype);
  const contextBuilder = {
    async _buildAgentContext() {
      throw new Error("snapshot identity validation should run before context build");
    },
  };

  await assert.rejects(
    () => engine._prepareStoppedSnapshotResumeTurnExecution({
      payload: {
        userId: "u1",
        sessionId: "s1",
        dialogProcessId: "dialog-current",
        turnScopeId: "turn-current",
        runConfig: {
          resumeFromStoppedSnapshot: true,
          resumeTurnScopeId: "turn-stopped",
          turnScopeId: "turn-current",
        },
      },
      contextBuilder,
    }),
    /stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId/,
  );
});
