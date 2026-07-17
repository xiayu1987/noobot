/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDoc2DataTool,
  decodeLibreOfficeTextBuffer,
} from "../../../src/system-core/tools/data-processing/doc2data-tool.js";
import {
  buildLibreOfficeTempPathTokensForNodePid,
  resolveLibreOfficeTempRoots,
} from "../../../src/system-core/tools/data-processing/doc2data/libreoffice.js";
import {
  createMedia2DataTool,
  resolveMediaBinaryPath,
  runMediaProcess,
} from "../../../src/system-core/tools/data-processing/media2data-tool.js";
import { createContentProcessTool } from "../../../src/system-core/tools/data-processing/content-process-tool.js";
import { createWeb2DataTool } from "../../../src/system-core/tools/data-processing/web2data-tool.js";
import { createConnectorAccessTool } from "../../../src/system-core/tools/connectors/connector-access-tool.js";
import { ERROR_CODE } from "../../../src/system-core/error/constants.js";
import { TOOL_NAME } from "../../../src/system-core/tools/constants/index.js";
import { buildAgentContext } from "./data-processing-guards.test-helpers.js";


test("web_to_data: empty input and urls should fail before network work", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-web2data-"));
  const tools = createWeb2DataTool({ agentContext: buildAgentContext(basePath) });
  const tool = tools.find((item) => item?.name === TOOL_NAME.WEB_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ input: "", urls: [] }),
    (error) =>
      error?.code === ERROR_CODE.RECOVERABLE_WEB_TO_DATA_FAILED &&
      Array.isArray(error?.details?.urls) &&
      error.details.urls.length === 0,
  );
});

test("web_to_data: direct fetch receives runtime abort signal", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-web2data-abort-"));
  const abortController = new AbortController();
  const fetchCalls = [];
  const tools = createWeb2DataTool({
    agentContext: {
      ...buildAgentContext(basePath),
      execution: {
        controllers: {
          runtime: {
            basePath,
            globalConfig: {},
            userConfig: {},
            abortSignal: abortController.signal,
            sharedTools: {
              fetch: async (url, options = {}) => {
                fetchCalls.push({ url, options });
                return {
                  ok: false,
                  status: 499,
                  text: async () => "",
                };
              },
            },
          },
        },
      },
    },
  });
  const tool = tools.find((item) => item?.name === TOOL_NAME.WEB_TO_DATA);
  assert.ok(tool);

  await assert.rejects(
    () => tool.invoke({ input: "https://example.test/slow" }),
    (error) => error?.code === ERROR_CODE.RECOVERABLE_WEB_TO_DATA_FAILED,
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.options?.signal, abortController.signal);
});
