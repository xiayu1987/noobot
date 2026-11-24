/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeExecutionProjectionOutputRecord,
  decodeExecutionProjectionOutputRecord,
  requireExecutionProjectionSourceId,
  compareExecutionProjectionSources,
  requireExecutionProjectionDeliveryContext,
  requireExecutionProjectionReceipt,
  requireExecutionProjectionIntent,
  executionProjectionReceiptName,
  executionProjectionOutputEntryBytes,
  executionProjectionPendingReceipts,
} from "../src/index.js";

test("entry reservations bound the complete envelope including escaping and all receipts", () => {
  const lines = ["plain", 'quote"slash\\', "control\u0000\n", "utf8😀\ud800"].map(
    (data) => `${JSON.stringify({ data })}\n`,
  );
  const receipts = lines.map((_, i) => ({ file: `/turn-${i}/receipt`, sourceId }));
  const reserved = lines.reduce(
    (total, line, i) => total + executionProjectionOutputEntryBytes(line, receipts[i]),
    0,
  );
  const record = { version: 1, offset: Number.MAX_SAFE_INTEGER, payload: lines.join(""), receipts };
  assert.ok(Buffer.byteLength(encodeExecutionProjectionOutputRecord(record)) <= reserved);
  assert.throws(
    () => executionProjectionOutputEntryBytes(lines[0], { ...receipts[0], extra: true }),
    TypeError,
  );
});

const sourceId = '["d1",1,0]';
test("entry reservations exactly measure both escaping layers for every UTF-16 code unit", () => {
  const receipt = { file: '/turn/中文"\\/receipt', sourceId };
  const cases = ['"\\\b\t\n\f\r\u0000', "😀\ud800x\udfff", "中文"];
  for (let start = 0; start < 65536; start += 256)
    cases.push(String.fromCharCode(...Array.from({ length: 256 }, (_, i) => start + i)));
  for (const data of cases) {
    const line = `${data}\n`;
    const record = {
      version: 1,
      offset: Number.MAX_SAFE_INTEGER,
      payload: line,
      receipts: [receipt],
    };
    assert.equal(
      executionProjectionOutputEntryBytes(line, receipt),
      Buffer.byteLength(encodeExecutionProjectionOutputRecord(record)),
    );
  }
});

const intent = () => ({
  version: 1,
  offset: 10,
  payload: '{"n":1}\n',
  receipts: [{ file: "/turn/receipt", sourceId }],
});

test("output records preserve strict UTF-8, verify their checksum and reject null envelopes", () => {
  const record = intent();
  const encoded = encodeExecutionProjectionOutputRecord(record);
  assert.deepEqual(decodeExecutionProjectionOutputRecord(Buffer.from(encoded)), record);
  const envelope = JSON.parse(encoded);
  envelope.payload = envelope.payload.replace('"offset":10', '"offset":11');
  assert.throws(
    () => decodeExecutionProjectionOutputRecord(Buffer.from(JSON.stringify(envelope))),
    /checksum/,
  );
  assert.throws(() => decodeExecutionProjectionOutputRecord(Buffer.from([255])), TypeError);
  assert.throws(
    () =>
      decodeExecutionProjectionOutputRecord(
        Buffer.from(encodeExecutionProjectionOutputRecord(null)),
      ),
    /object/,
  );
});

test("projection identity ordering is numeric, canonical and confined to one turn", () => {
  assert.deepEqual(requireExecutionProjectionSourceId(sourceId), ["d1", 1, 0]);
  assert.equal(compareExecutionProjectionSources('["d1",10,0]', '["d1",2,999]'), 1);
  for (const invalid of [
    '["d1", 1,0]',
    '["d1",0,0]',
    '["d1",1,-1]',
    '["d1",1,9007199254740992]',
    "null",
    "{}",
    undefined,
  ])
    assert.throws(() => requireExecutionProjectionSourceId(invalid));
  assert.throws(() => compareExecutionProjectionSources(sourceId, '["d2",1,0]'), /another turn/);
});

test("projection output contracts reject missing ownership, unknown fields and duplicate receipts", () => {
  assert.deepEqual(requireExecutionProjectionDeliveryContext({ receiptDirectory: "/turn" }), {
    receiptDirectory: "/turn",
  });
  for (const value of [{}, { receiptDirectory: "" }, { receiptDirectory: "/turn", extra: true }])
    assert.throws(() => requireExecutionProjectionDeliveryContext(value), TypeError);
  assert.equal(
    executionProjectionReceiptName("debug-model.jsonl"),
    "projection-receipt.debug-model.jsonl.json",
  );
  assert.throws(() => executionProjectionReceiptName("../interaction.jsonl"), TypeError);
  assert.deepEqual(requireExecutionProjectionReceipt({ version: 1, sourceId }), {
    version: 1,
    sourceId,
  });
  assert.throws(
    () => requireExecutionProjectionReceipt({ version: 1, sourceId, extra: true }),
    TypeError,
  );
  assert.deepEqual(requireExecutionProjectionIntent(intent()), intent());
  for (const value of [
    { ...intent(), offset: -1 },
    { ...intent(), payload: "incomplete" },
    { ...intent(), receipts: [] },
    { ...intent(), receipts: [...intent().receipts, ...intent().receipts] },
  ])
    assert.throws(() => requireExecutionProjectionIntent(value), TypeError);
});

test("recovery confirms covered intents without rolling back advanced receipts", () => {
  const record = intent();
  const receipt = (offset) => ({ version: 1, sourceId: `["d1",1,${offset}]` });
  assert.deepEqual(executionProjectionPendingReceipts(record, [null]), record.receipts);
  assert.deepEqual(executionProjectionPendingReceipts(record, [receipt(0)]), []);
  assert.deepEqual(executionProjectionPendingReceipts(record, [receipt(10)]), []);
  record.receipts[0].sourceId = receipt(10).sourceId;
  assert.deepEqual(executionProjectionPendingReceipts(record, [receipt(0)]), record.receipts);
  for (const invalid of [[], [undefined], [{ version: 1, sourceId: '["foreign",1,0]' }]])
    assert.throws(() => executionProjectionPendingReceipts(record, invalid), TypeError);
});

test("recovery rejects an advanced receipt mixed with unconfirmed ownership", () => {
  const record = intent();
  record.receipts.push({ file: "/second/receipt", sourceId: '["d2",1,10]' });
  const advanced = { version: 1, sourceId: '["d1",1,10]' };
  for (const unconfirmed of [null, { version: 1, sourceId: '["d2",1,0]' }])
    assert.throws(
      () => executionProjectionPendingReceipts(record, [advanced, unconfirmed]),
      /advanced and unconfirmed/,
    );
  assert.deepEqual(
    executionProjectionPendingReceipts(record, [{ version: 1, sourceId: '["d1",1,0]' }, null]),
    [record.receipts[1]],
  );
});
