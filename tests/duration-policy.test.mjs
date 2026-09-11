import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLimits } from '../dist/duration-policy.js';

// Invalid-value matrix adapted from the MIT Orca kernel-run-limits tests; see README.
for (const key of ['timeoutMs', 'outputLimitBytes']) {
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    test(`rejects invalid ${key}: ${String(value)}`, () => assert.throws(() => parseLimits({ [key]: value }), /finite positive/));
  }
}
for (const value of [null, [], { unknown: 2 }]) {
  test(`rejects invalid limits object ${JSON.stringify(value)}`, () => assert.throws(() => parseLimits(value)));
}
test('keeps finite defaults and rejects impractical deadlines', () => {
  assert.equal(parseLimits().timeoutMs, 120_000);
  assert.equal(parseLimits({ timeoutMs: 100 }).timeoutMs, 100);
  assert.throws(() => parseLimits({ timeoutMs: 900_001 }), /Maximum/);
});
