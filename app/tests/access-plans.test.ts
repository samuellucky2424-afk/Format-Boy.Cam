import test from 'node:test';
import assert from 'node:assert/strict';
import { isAccessActive } from '../api/access.js';

test('timed access expires and unlimited access does not', () => {
  const now = Date.parse('2026-11-17T00:00:00Z');
  assert.equal(isAccessActive({ status: 'active', plan_name: '2 Weeks', ends_at: '2026-11-16T00:00:00Z' }, now), false);
  assert.equal(isAccessActive({ status: 'active', plan_name: '30 Days', ends_at: '2026-12-17T00:00:00Z' }, now), true);
  assert.equal(isAccessActive({ status: 'active', plan_name: 'Unlimited', ends_at: null }, now), true);
  assert.equal(isAccessActive({ status: 'active', plan_name: '2 Weeks', ends_at: null }, now), false);
  assert.equal(isAccessActive({ status: 'expired', plan_name: 'Unlimited', ends_at: null }, now), false);
});
