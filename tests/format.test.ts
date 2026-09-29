import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayMetric } from '../src/web/format';
// 数值显示(frontend-spec 0.4)。
test('metric values: qualifiers, currency, truncation and compact units', () => {
  assert.equal(displayMetric(null), '—');
  assert.equal(displayMetric({ value: null, unit: 'USD' }), '—');
  assert.equal(displayMetric({ value: '1234567.899', unit: 'USD' }), '$1,234,567.89');
  assert.equal(displayMetric({ value: '12.34567', unit: 'BTC' }), '12.3456');
  assert.equal(displayMetric({ value: '9.5', unit: '/10' }), '9.5/10');
  assert.equal(displayMetric({ value: '100', unit: 'markets', qualifier: 'at_least' }), '≥100');
  assert.equal(displayMetric({ value: '2500000', unit: 'USD' }, true), '$2.50M');
  assert.equal(displayMetric({ value: '3100000000', unit: 'people' }, true), '3.10B');
  assert.equal(
    displayMetric({ value: '4000000000000', unit: 'USD', qualifier: 'approximately' }, true),
    '≈$4.00T',
  );
  assert.equal(displayMetric({ value: '999999', unit: 'visits' }, true), '999,999');
});
