import { createRequire } from "node:module";
import { parseWorkflowDslText } from "../protocol/text-protocol.js";
import { WORKFLOW_PLUGIN_DEFAULTS } from "../core/constants.js";

const require = createRequire(import.meta.url);

function loadWorkflowLib() {
  const workflow = require("workflow");
  if (!workflow || typeof workflow.executeWorkflowSemantic !== "function") {
    throw new Error("workflow lib missing executeWorkflowSemantic facade");
  }
  return workflow;
}

export function executeWorkflowText({ semanticText = "", options = {} } = {}) {
  const workflow = loadWorkflowLib();
  const semantic = parseWorkflowDslText(semanticText);
  const execution = workflow.executeWorkflowSemantic({
    semantic,
    options: {
      autoSubmit: options?.autoSubmit !== false,
      maxAutoTransitions:
        Number.isFinite(Number(options?.maxAutoTransitions)) && Number(options.maxAutoTransitions) > 0
          ? Math.floor(Number(options.maxAutoTransitions))
          : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_MAX_AUTO_TRANSITIONS,
    },
  });
  return {
    semantic,
    execution,
  };
}
