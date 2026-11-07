/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_OPERATION_KIND,
  MODEL_GENERATION_OPTION_FIELDS,
  normalizeModelOperation,
} from "@noobot/model-protocol";

export function buildGenerationOperation({ input, prompt }) {
  const options = {};
  const fields = Object.assign({}, ...Object.values(MODEL_GENERATION_OPTION_FIELDS));
  for (const [source, target] of Object.entries(fields)) {
    if (input[source] !== undefined) options[target] = input[source];
  }
  return normalizeModelOperation({
    kind: MODEL_OPERATION_KIND.MEDIA_GENERATION,
    input: { prompt, outputType: input.output_type },
    options,
  });
}
