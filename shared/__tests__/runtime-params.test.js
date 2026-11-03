/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createDefaultRuntimeParamsDocument,
  RUNTIME_PARAM_CATALOG,
  validateRuntimeOverrides,
  validateRuntimeParamsDocument,
} from "../runtime-params.js";
import {
  createRuntimeParamsStore,
  readRuntimeParamsDocument,
  assertRuntimeParamsFileWriteAllowed,
} from "../runtime-params-node.js";
import { runtimeParamsZhCN } from "../../i18n/src/client/locales/runtime-params-zh-CN.js";
import { runtimeParamsEnUS } from "../../i18n/src/client/locales/runtime-params-en-US.js";

const key = "quantity.memory.maxItems";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-params-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "runtime-params.json");
  const active = createDefaultRuntimeParamsDocument();
  return { file, store: createRuntimeParamsStore(file, { active: () => active }) };
}

test("catalog has unique keys, valid defaults, and translated names and descriptions", () => {
  assert.equal(
    new Set(RUNTIME_PARAM_CATALOG.map((item) => item.key)).size,
    RUNTIME_PARAM_CATALOG.length,
  );
  assert.deepEqual(validateRuntimeOverrides({}), {});
  for (const item of RUNTIME_PARAM_CATALOG) {
    assert.ok(Number.isSafeInteger(item.defaultValue));
    assert.ok(item.defaultValue >= item.minimum, item.key);
    assert.ok(item.defaultValue <= item.maximum, item.key);
    if (["time", "length"].includes(item.category)) assert.notEqual(item.unit, "count", item.key);
    for (const messages of [runtimeParamsZhCN, runtimeParamsEnUS]) {
      for (const translationKey of [
        item.nameKey,
        item.descriptionKey,
        `runtimeParams.categories.${item.category}`,
        `runtimeParams.modules.${item.module}`,
      ]) {
        const text = translationKey
          .split(".")
          .slice(1)
          .reduce((value, part) => value?.[part], messages);
        assert.equal(typeof text, "string", translationKey);
        assert.ok(text.trim(), translationKey);
      }
    }
  }
});

test("invalid values, unknown keys, fixed constraints and inconsistent bounds are rejected", () => {
  for (const overrides of [
    { [key]: -1 },
    { [key]: 1.5 },
    { [key]: "4" },
    { [key]: null },
    { missing: 4 },
    { "length.connectorSecrets.keyBytes": 64 },
    { "time.agent.minRunTimeoutMs": 2000, "time.agent.runTimeoutMs": 1000 },
  ])
    assert.throws(() => validateRuntimeOverrides(overrides));
});

test("override keys come from the catalog and cannot inject object properties", () => {
  for (const name of ["__proto__", "constructor", "prototype", "toString"]) {
    assert.throws(() => validateRuntimeOverrides(JSON.parse(`{"${name}":42}`)), {
      code: "UNKNOWN_RUNTIME_PARAM",
    });
  }
  const overrides = validateRuntimeOverrides({ [key]: 42 });
  assert.equal(Object.getPrototypeOf(overrides), Object.prototype);
  assert.deepEqual(overrides, { [key]: 42 });
  const definition = RUNTIME_PARAM_CATALOG.find((item) => item.key === key);
  assert.deepEqual(validateRuntimeOverrides({ [key]: definition.defaultValue }), {});
});

test("save is atomic, audited, revision guarded, and does not change the active snapshot", (t) => {
  const { file, store } = fixture(t);
  const saved = store.save({ revision: 0, overrides: { [key]: 42 } }, "admin");
  assert.equal(saved.revision, 1);
  assert.equal(saved.activeRevision, 0);
  assert.equal(saved.restartRequired, true);
  assert.equal(saved.catalog.find((item) => item.key === key).savedValue, 42);
  assert.notEqual(saved.catalog.find((item) => item.key === key).activeValue, 42);
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => store.save({ revision: 0, overrides: {} }, "admin"), {
    code: "RUNTIME_PARAMS_CONFLICT",
    statusCode: 409,
  });
  assert.throws(() => store.save({ revision: 1, overrides: { [key]: -1 } }, "admin"));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const lockRecord = (pid) => `${pid}:00000000-0000-4000-8000-000000000000`;
  fs.writeFileSync(`${file}.lock`, lockRecord(process.pid));
  assert.throws(() => store.save({ revision: 1, overrides: {} }, "admin"), {
    code: "RUNTIME_PARAMS_BUSY",
    statusCode: 409,
  });
  fs.writeFileSync(`${file}.lock`, "");
  assert.throws(() => store.save({ revision: 1, overrides: {} }, "admin"), {
    code: "RUNTIME_PARAMS_LOCK_CORRUPTED",
    statusCode: 500,
  });
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const exited = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  fs.writeFileSync(`${file}.lock`, lockRecord(Number(exited.stdout)));
  const restored = store.save({ revision: 1, overrides: {} }, "admin");
  assert.equal(restored.revision, 2);
  assert.deepEqual(restored.overrides, {});
  const document = readRuntimeParamsDocument(file);
  assert.equal(document.history.length, 2);
  assert.equal(document.history[0].changes[0].after, 42);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)]);
});

test("a lock replaced during save reports corruption and keeps the work failure as cause", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-params-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "runtime-params.json");
  const workFailure = new Error("active snapshot unavailable");
  const store = createRuntimeParamsStore(file, {
    active: () => {
      fs.writeFileSync(`${file}.lock`, `${process.pid}:00000000-0000-4000-8000-000000000001`);
      throw workFailure;
    },
  });
  assert.throws(
    () => store.save({ revision: 0, overrides: { [key]: 42 } }, "admin"),
    (error) => error.code === "RUNTIME_PARAMS_LOCK_CORRUPTED" && error.cause === workFailure,
  );
});

test("invalid requests never create a parameter document", (t) => {
  const { file, store } = fixture(t);
  assert.throws(() => store.save({ revision: 0, overrides: { [key]: -1 } }, "admin"));
  assert.throws(() => fs.readFileSync(file), { code: "ENOENT" });
  assert.throws(() =>
    validateRuntimeParamsDocument({ ...createDefaultRuntimeParamsDocument(), revision: 1 }),
  );
  fs.writeFileSync(file, "{", { flag: "wx" });
  assert.throws(
    () => readRuntimeParamsDocument(file),
    (error) =>
      error.code === "INVALID_RUNTIME_PARAMS_DOCUMENT" &&
      error.statusCode === 400 &&
      error.message.includes(file) &&
      error.cause instanceof SyntaxError,
  );
});

test("malformed audit changes are rejected instead of accepted as authoritative history", () => {
  for (const changes of [
    [null],
    [{ key: "missing", before: 1, after: 2 }],
    [{ key, before: "1", after: 2 }],
    [{ key, before: 2, after: 2 }],
    [
      { key, before: 1, after: 2 },
      { key, before: 2, after: 3 },
    ],
  ]) {
    assert.throws(
      () =>
        validateRuntimeParamsDocument({
          schemaVersion: 1,
          revision: 1,
          overrides: { [key]: 2 },
          history: [{ revision: 1, actor: "admin", at: new Date().toISOString(), changes }],
        }),
      { code: "INVALID_RUNTIME_PARAMS_DOCUMENT" },
    );
  }
});

test("fixed thresholds read before initialization; editable thresholds require the snapshot", () => {
  const script = `
    import {QUANTITY_THRESHOLDS} from ${JSON.stringify(new URL("../quantity-thresholds.js", import.meta.url).href)};
    import {TIME_THRESHOLDS} from ${JSON.stringify(new URL("../time-thresholds.js", import.meta.url).href)};
    import {LENGTH_THRESHOLDS} from ${JSON.stringify(new URL("../length-thresholds.js", import.meta.url).href)};
    import {activateRuntimeParams} from ${JSON.stringify(new URL("../runtime-params.js", import.meta.url).href)};
    const fixed = [QUANTITY_THRESHOLDS.attachments.maxFileCount, TIME_THRESHOLDS.service.startupStallTimeoutMs, LENGTH_THRESHOLDS.desktopLogging.maxFileBytes];
    let rejected = false;
    try { void LENGTH_THRESHOLDS.modelProxy.logFileBytes; } catch { rejected = true; }
    if (!rejected) throw new Error('uninitialized editable read was accepted');
    activateRuntimeParams({schemaVersion: 1, revision: 7, overrides: {'quantity.memory.maxItems': 17, 'length.modelProxy.logFileBytes': 4096}});
    console.log(JSON.stringify({fixed: fixed.every(Number.isSafeInteger), value: QUANTITY_THRESHOLDS.memory.maxItems, proxy: LENGTH_THRESHOLDS.modelProxy.logFileBytes}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { fixed: true, value: 17, proxy: 4096 });
  for (const fixedKey of [
    "quantity.attachments.maxFileCount",
    "time.service.startupStallTimeoutMs",
    "length.desktopLogging.maxFileBytes",
  ])
    assert.throws(() => validateRuntimeOverrides({ [fixedKey]: 1 }), fixedKey);
});

test("generic writes reject protected file, temporary siblings and symlink aliases", (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, "{}");
  const alias = path.join(path.dirname(file), "alias.json");
  fs.symlinkSync(file, alias);
  for (const target of [file, `${file}.lock`, `${file}.test.tmp`, alias]) {
    assert.throws(() => assertRuntimeParamsFileWriteAllowed(target, file), { statusCode: 403 });
  }
  assert.doesNotThrow(() =>
    assertRuntimeParamsFileWriteAllowed(path.join(path.dirname(file), "other.json"), file),
  );
});

test("independent restarted processes activate the same persisted revision and thresholds", (t) => {
  const { file, store } = fixture(t);
  store.save({ revision: 0, overrides: { [key]: 42 } }, "admin");
  const script = `import {initializeRuntimeParams} from ${JSON.stringify(new URL("../runtime-params-node.js", import.meta.url).href)};
    initializeRuntimeParams(${JSON.stringify(file)});
    const {activeRuntimeParams} = await import(${JSON.stringify(new URL("../runtime-params.js", import.meta.url).href)});
    const {QUANTITY_THRESHOLDS} = await import(${JSON.stringify(new URL("../quantity-thresholds.js", import.meta.url).href)});
    console.log(JSON.stringify({revision: activeRuntimeParams().revision, value: QUANTITY_THRESHOLDS.memory.maxItems}));`;
  for (let index = 0; index < 3; index += 1) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { revision: 1, value: 42 });
  }
});
