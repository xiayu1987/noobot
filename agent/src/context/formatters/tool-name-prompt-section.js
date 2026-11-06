/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { compileToolNamePrompt, TOOL_NAME_REFERENCE_BLOCK } from "@noobot/model-protocol";
import { assignContextMessageIdentity } from "@noobot/context-protocol/message/codec";

export function toolNamePromptSection(content) {
  const blocks = typeof content === "string" ? compileToolNamePrompt(content) : content;
  if (!blocks.some((block) => block.type === TOOL_NAME_REFERENCE_BLOCK))
    return blocks.map((block) => block.text).join("");
  return assignContextMessageIdentity({ role: "system", content: blocks });
}

export function scenarioPromptSection(title, scenario) {
  const entries = Object.entries(scenario);
  if (!entries.length) return "";
  const blocks = [{ type: "text", text: `# ${title}\n{\n` }];
  entries.forEach(([key, value], index) => {
    blocks.push({ type: "text", text: `  ${JSON.stringify(key)}: ` });
    if (key === "description" && typeof value === "string") {
      blocks.push(...compileToolNamePrompt(JSON.stringify(value)));
    } else if (key === "tools" && Array.isArray(value)) {
      blocks.push({ type: "text", text: "[" });
      value.forEach((toolId, toolIndex) => {
        if (toolIndex) blocks.push({ type: "text", text: ", " });
        if (toolId === "*") blocks.push({ type: "text", text: '"*"' });
        else
          blocks.push(
            { type: "text", text: '"' },
            { type: TOOL_NAME_REFERENCE_BLOCK, toolId },
            { type: "text", text: '"' },
          );
      });
      blocks.push({ type: "text", text: "]" });
    } else blocks.push({ type: "text", text: JSON.stringify(value, null, 2) });
    blocks.push({ type: "text", text: index < entries.length - 1 ? ",\n" : "\n}" });
  });
  return toolNamePromptSection(blocks);
}
