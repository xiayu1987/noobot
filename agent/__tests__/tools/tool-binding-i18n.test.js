/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createToolNameBinding } from "@noobot/model-protocol";
import { runWithToolNameBinding } from "@noobot/model-protocol/tool-binding-scope-node";
import { tTool, tToolTemplate } from "../../src/tools/core/tool-i18n.js";
import {
  tToolDescription,
  tToolManual,
  tToolParamDescription,
} from "../../src/tools/core/tool-schema-i18n.js";

for (const locale of ["zh-CN", "en-US"]) {
  test(`localized templates render tool references without interpreting inserted data (${locale})`, () => {
    const runtime = {
      runConfig: { locale },
      globalConfig: { tools: { bindings: { read_file: { bindingName: "nb_read" } } } },
      userConfig: {},
    };
    const inputs = "{{tool:read_file}}.txt";
    const bound = (run) =>
      runWithToolNameBinding(
        createToolNameBinding({ bindings: runtime.globalConfig.tools.bindings }),
        run,
      );
    assert.throws(
      () => tTool(runtime, "tools.multimodalParse.directTextUnsupported", { inputs }),
      /binding/i,
    );
    const result = bound(() =>
      tTool(runtime, "tools.multimodalParse.directTextUnsupported", { inputs }),
    );
    assert.ok(result.includes(inputs));
    assert.ok(result.includes("nb_read"));
    assert.equal(result.includes("nb_read.txt"), false);
    const plain = tTool(runtime, "tools.input.fieldRequired", { field: inputs });
    assert.ok(plain.includes(inputs));
    assert.ok(tToolTemplate(runtime, "tools.help.description").includes("{{tool:read_file}}"));
    assert.ok(tToolDescription(runtime, "execute_native_script").includes("{{tool:help}}"));
    assert.ok(
      tToolParamDescription(runtime, "execute_native_script", "script_body").includes(
        "{{tool:help}}",
      ),
    );
    assert.ok(bound(() => JSON.stringify(tToolManual(runtime, "help"))).includes("nb_read"));
    runtime.globalConfig.tools.bindings.read_file.bindingName = "next_read";
    assert.ok(
      bound(() =>
        tTool(runtime, "tools.multimodalParse.directTextUnsupported", { inputs }),
      ).includes("next_read"),
    );
    const manual = bound(() => JSON.stringify(tToolManual(runtime, "help")));
    assert.ok(manual.includes("next_read"));
    assert.equal(manual.includes("nb_read"), false);
  });
}
