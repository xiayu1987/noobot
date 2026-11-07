/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_GENERATION_API_TYPE,
  MODEL_GENERATION_API_HEADERS,
  resolveModelGenerationApiType,
} from "@noobot/model-protocol";
import {
  generateOpenAiImages,
  generateXaiImages,
  generateDashscopeImages,
} from "./native-image-generation.js";
import { generateGeminiInteraction, generateGeminiContent } from "./native-gemini-generation.js";
import {
  generateXaiVideo,
  generateMinimaxVideo,
  generateDashscopeVideo,
} from "./native-video-generation.js";

const PROTOCOLS = new Map([
  [MODEL_GENERATION_API_TYPE.OPENAI_IMAGES, generateOpenAiImages],
  [MODEL_GENERATION_API_TYPE.XAI_IMAGES, generateXaiImages],
  [MODEL_GENERATION_API_TYPE.DASHSCOPE_MULTIMODAL, generateDashscopeImages],
  [MODEL_GENERATION_API_TYPE.GEMINI_GENERATE_CONTENT, generateGeminiContent],
  [MODEL_GENERATION_API_TYPE.GEMINI_INTERACTIONS, generateGeminiInteraction],
  [MODEL_GENERATION_API_TYPE.XAI_VIDEO, generateXaiVideo],
  [MODEL_GENERATION_API_TYPE.DASHSCOPE_VIDEO, generateDashscopeVideo],
  [MODEL_GENERATION_API_TYPE.MINIMAX_VIDEO, generateMinimaxVideo],
]);

export async function executeNativeGeneration(input) {
  const apiType = resolveModelGenerationApiType(input.modelSpec);
  const protocol = PROTOCOLS.get(apiType);

  if (!(input.signal instanceof AbortSignal))
    throw new TypeError("native generation requires a caller-owned abort signal");
  input.signal.throwIfAborted();
  const google = [
    MODEL_GENERATION_API_TYPE.GEMINI_INTERACTIONS,
    MODEL_GENERATION_API_TYPE.GEMINI_GENERATE_CONTENT,
  ].includes(apiType);
  const headers = { ...input.headers, ...MODEL_GENERATION_API_HEADERS[apiType] };
  delete headers.Authorization;
  delete headers.authorization;
  if (google) {
    headers["x-goog-api-key"] = input.credential;
  } else {
    headers.Authorization = `Bearer ${input.credential}`;
  }
  return protocol({ ...input, headers });
}
