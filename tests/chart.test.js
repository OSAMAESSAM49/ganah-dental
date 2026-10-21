import { describe, test, assert } from './runner.js';
import { parseTeeth, surfaceLabel, surfacesText, isValidTooth, toothName, sortTeeth, ALL_TEETH } from '../js/core/teeth.js';
import { foldChart, toothConditions, inferChartEffect } from '../js/core/chart-conditions.js';
import { regionSurfaces } from '../js/components/odontogram.js';
import { itemMath, planTotals } from '../js/services/treatment.js';
import { parseSurfaces } from '../js/modules/patients/plan-dialogs.js';

let n = 0;
const ev = (tooth, type, condition, surfaces = [], extra = {}) => ({ tooth, type, condition, surfaces, at: `2026-10-${String(10 + (n++ % 20)).padStart(2, '0')}T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });

describe('teeth (FDI)', () => {
  test('52 valid teeth, invalid numbers rejected', () => {
    assert.equal(ALL_TEETH.length, 52);
    assert.ok(isValidTooth(18) && isValidTooth(85) && !isValidTooth(19) && !isValidTooth(56) && !isValidTooth(90));
  });
  test('parseTeeth handles lists, ranges and Arabic digits', () => {
    assert.deepEqual(parseTeeth('16, 26 ١١-١٣'), [11, 12, 13, 16, 26]);
    assert.deepEqual(parseTeeth('18-21'), [], 'ranges across quadrants are ignored');
    assert.deepEqual(parseTeeth('99, abc'), []);
  });
  test('surface labels adapt to the tooth', () => {
    assert.equal(surfaceLabel(11, 'O').code, 'I');
    assert.equal(surfaceLabel(11, 'B').code, 'F');
    assert.equal(surfaceLabel(16, 'L').code, 'P');
    assert.equal(surfaceLabel(46, 'L').code, 'L');
    assert.equal(surfacesText(36, ['D', 'O', 'M']), 'MOD');
  });
  test('names and display order', () => {
    assert.ok(toothName(16).includes('ضرس أول') && toothName(16).includes('علوي أيمن'));
    assert.ok(toothName(75).includes('لبني'));
    assert.deepEqual(sortTeeth([11, 48, 18, 21]), [18, 11, 21, 48]);
  });
  test('odontogram regions: mesial faces the midline, buccal faces outward', () => {
    assert.deepEqual(regionSurfaces(16), { center: 'O', top: 'B', bottom: 'L', left: 'D', right: 'M' });
    assert.deepEqual(regionSurfaces(26), { center: 'O', top: 'B', bottom: 'L', left: 'M', right: 'D' });
    assert.deepEqual(regionSurfaces(36), { center: 'O', top: 'L', bottom: 'B', left: 'M', right: 'D' });
  });
});

describe('chart fold', () => {
  test('filling replaces caries on the same surfaces only', () => {
    const s = foldChart([ev(16, 'add', 'caries', ['M', 'O', 'D']), ev(16, 'add', 'filled', ['O'])]);
    const c = Object.fromEntries(toothConditions(s, 16).map((x) => [x.key, x.surfaces]));
    assert.deepEqual(c.caries.sort(), ['D', 'M']);
    assert.deepEqual(c.filled, ['O']);
  });
  test('missing clears the tooth; implant replaces missing', () => {
    let s = foldChart([ev(36, 'add', 'caries', ['O']), ev(36, 'add', 'extract'), ev(36, 'add', 'missing')]);
    assert.deepEqual(toothConditions(s, 36).map((c) => c.key), ['missing']);
    s = foldChart([ev(36, 'add', 'missing'), ev(36, 'add', 'implant'), ev(36, 'add', 'crown')]);
    assert.deepEqual(toothConditions(s, 36).map((c) => c.key).sort(), ['crown', 'implant']);
  });
  test('remove, clear, void and history (until)', () => {
    n = 0;
    const events = [
      ev(11, 'add', 'caries', ['M']),          // 10th
      ev(11, 'add', 'rct'),                    // 11th
      ev(11, 'remove', 'rct'),                 // 12th
      ev(21, 'add', 'crown'),                  // 13th
      ev(21, 'clear'),                         // 14th
      ev(22, 'add', 'fractured', [], { voided: true }),
    ];
    const now = foldChart(events);
    assert.deepEqual(toothConditions(now, 11).map((c) => c.key), ['caries']);
    assert.equal(now.has(21), false);
    assert.equal(now.has(22), false, 'voided events are ignored');
    const then = foldChart(events, '2026-10-11T23:59:59Z');
    assert.deepEqual(toothConditions(then, 11).map((c) => c.key), ['caries', 'rct']);
  });
  test('procedure → chart effect inference', () => {
    assert.equal(inferChartEffect('حشو عصب (ضرس)'), 'rct');
    assert.equal(inferChartEffect('حشو تجميلي عالي الجودة'), 'filled');
    assert.equal(inferChartEffect('حشو مؤقت'), 'temporary');
    assert.equal(inferChartEffect('كراون زيركون'), 'crown');
    assert.equal(inferChartEffect('فينير إيماكس'), 'veneer');
    assert.equal(inferChartEffect('خلع ضرس عقل'), 'missing');
    assert.equal(inferChartEffect('تنظيف جير'), '');
  });
});

describe('treatment money', () => {
  test('itemMath: amount and percent discounts, capped at the price', () => {
    assert.deepEqual(itemMath({ unitPrice: 50000, qty: 2 }), { gross: 100000, discount: 0, total: 100000 });
    assert.deepEqual(itemMath({ unitPrice: 50000, qty: 2, discountType: 'percent', discountValue: 10 }), { gross: 100000, discount: 10000, total: 90000 });
    assert.deepEqual(itemMath({ unitPrice: 50000, qty: 1, discountType: 'amount', discountValue: 70000 }), { gross: 50000, discount: 50000, total: 0 });
    assert.deepEqual(itemMath({ unitPrice: 33333, qty: 1, discountType: 'percent', discountValue: 33.3 }).discount, 11100);
  });
  test('planTotals excludes cancelled items and tracks done/remaining', () => {
    const t = planTotals([
      { unitPrice: 100000, qty: 1, status: 'done' },
      { unitPrice: 50000, qty: 1, status: 'planned', discountType: 'amount', discountValue: 5000 },
      { unitPrice: 99900, qty: 1, status: 'cancelled' },
    ]);
    assert.deepEqual(t, { count: 2, gross: 150000, discount: 5000, net: 145000, done: 100000, remaining: 45000 });
  });
  test('parseSurfaces maps I/F/P to canonical codes', () => {
    assert.deepEqual(parseSurfaces('mod'), ['M', 'O', 'D']);
    assert.deepEqual(parseSurfaces('IF'), ['O', 'B']);
    assert.deepEqual(parseSurfaces('P x'), ['L']);
  });
});
