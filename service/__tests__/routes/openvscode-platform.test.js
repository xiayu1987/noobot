import test from "node:test";
import assert from "node:assert/strict";

import { taskkillProcessTreeBestEffort } from "../../services/openvscode-service.js";

test("openvscode: Windows process tree cleanup uses taskkill with numeric pid", () => {
  const calls = [];
  const ok = taskkillProcessTreeBestEffort("1234", {
    execFileImpl: (command, args, options, callback) => {
      calls.push({ command, args, options });
      callback?.(null, "", "");
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [
    {
      command: "taskkill",
      args: ["/PID", "1234", "/T", "/F"],
      options: { windowsHide: true },
    },
  ]);
});

test("openvscode: Windows process tree cleanup rejects invalid pids", () => {
  const calls = [];
  const ok = taskkillProcessTreeBestEffort("1234 & calc", {
    execFileImpl: (...args) => {
      calls.push(args);
    },
  });

  assert.equal(ok, false);
  assert.deepEqual(calls, []);
});
