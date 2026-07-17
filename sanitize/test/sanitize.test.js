import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePersonalInformation,
  sanitizeSecrets,
  sanitizeToolResultText,
} from '../src/index.js';

test('masks personal information while preserving length and punctuation', () => {
  const input = 'mail jane.doe@example.com phone +86 13812345678';
  const output = sanitizePersonalInformation(input);
  assert.equal(output.length, input.length);
  assert.equal(output, 'mail xxxx.xxx@xxxxxxx.xxx phone +xx xxxxxxxxxxx');
});

test('masks valid Chinese ID and Luhn-valid bank card only', () => {
  const input = 'ID 11010519491231002X card 4111111111111111 invalid 4111111111111112';
  const output = sanitizePersonalInformation(input);
  assert.equal(output, 'ID xxxxxxxxxxxxxxxxxx card xxxxxxxxxxxxxxxx invalid 4111111111111112');
});

test('masks international PII with validation and preserves formatting', () => {
  const input = [
    'phone +1 (415) 555-2671',
    'ssn 123-45-6789 invalid 000-12-3456',
    'iban GB82 WEST 1234 5698 7654 32',
    'ipv4 203.0.113.42 ipv6 2001:db8::1',
    'mac 00:1A:2B:3C:4D:5E',
    'passport number: X12345678',
  ].join('\n');
  const output = sanitizePersonalInformation(input);
  assert.equal(output.length, input.length);
  assert.equal(output, [
    'phone +x (xxx) xxx-xxxx',
    'ssn xxx-xx-xxxx invalid 000-12-3456',
    'iban xxxx xxxx xxxx xxxx xxxx xx',
    'ipv4 xxx.x.xxx.xx ipv6 xxxx:xxx::x',
    'mac xx:xx:xx:xx:xx:xx',
    'passport number: xxxxxxxxx',
  ].join('\n'));
});

test('does not mask invalid international identifiers or file paths', () => {
  const input = 'iban GB82 TEST 1234 ssn 666-12-3456 path=/home/admin/203.0.113/project';
  assert.equal(sanitizePersonalInformation(input), input);
});

test('self-maintained secret rules replace credentials without changing content shape', () => {
  const input = 'github=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const output = sanitizeSecrets(input);
  assert.equal(output.length, input.length);
  assert.equal(output, 'github=xxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
});

test('masks structured and contextual secrets but leaves paths and ordinary hashes unchanged', () => {
  const input = [
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    'aws=AKIA1234567890ABCDEF',
    'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456',
    'client_secret="highEntropy-Value_1234567890"',
    'hash=0123456789abcdef0123456789abcdef',
    'path=/home/admin/private/project',
  ].join('\n');
  const output = sanitizeSecrets(input);
  assert.equal(output.length, input.length);
  assert.match(output, /Authorization: Bearer x+/);
  assert.doesNotMatch(output, /AKIA|eyJhbGci|highEntropy/);
  assert.match(output, /hash=0123456789abcdef0123456789abcdef/);
  assert.match(output, /path=\/home\/admin\/private\/project/);
});

test('tool result combines field, secret and PII sanitization', async () => {
  const output = await sanitizeToolResultText(JSON.stringify({
    password: 'do-not-return',
    message: 'mail jane@example.com token ghp_1234567890abcdefghijklmnopqrstuvwxyz',
  }));
  const parsed = JSON.parse(output);
  assert.equal(parsed.password, '[Redacted]');
  assert.doesNotMatch(parsed.message, /jane|example|ghp_/);
  assert.equal(parsed.message.length, 'mail jane@example.com token ghp_1234567890abcdefghijklmnopqrstuvwxyz'.length);
});
