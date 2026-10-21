import { describe, test, assert } from './runner.js';
import {
  formatMoney, toPiasters, formatDate, formatTime, parseDateInput, toISODate, ageFromDOB, formatAge,
  setDigitStyle, formatPercent, piastersToInput, formatBytes,
} from '../js/core/format.js';

describe('format', () => {
  test('money: piasters → EGP, decimals only when needed', () => {
    setDigitStyle('western');
    assert.equal(formatMoney(125000), '1,250 ج.م');
    assert.equal(formatMoney(125050), '1,250.50 ج.م');
    assert.equal(formatMoney(0), '0 ج.م');
    assert.equal(formatMoney(500, { currency: false }), '5');
    assert.equal(formatMoney(null), '—');
  });
  test('money with Arabic-Indic digits', () => {
    setDigitStyle('arabic');
    assert.equal(formatMoney(125000), '١٬٢٥٠ ج.م');
    setDigitStyle('western');
  });
  test('toPiasters parses user input', () => {
    assert.equal(toPiasters('1,250.5'), 125050);
    assert.equal(toPiasters('١٢٥٠٫٥'), 125050);
    assert.equal(toPiasters('300'), 30000);
    assert.equal(toPiasters(12.34), 1234);
    assert.ok(Number.isNaN(toPiasters('abc')));
    assert.ok(Number.isNaN(toPiasters('1.234')), 'max two decimals');
    assert.equal(piastersToInput(125050), '1250.5');
  });
  test('dates are DD/MM/YYYY and YYYY-MM-DD is a local day', () => {
    assert.equal(formatDate('2026-03-05'), '05/03/2026');
    assert.equal(toISODate(new Date(2026, 0, 31)), '2026-01-31');
    setDigitStyle('arabic');
    assert.equal(formatDate('2026-03-05'), '٠٥/٠٣/٢٠٢٦');
    setDigitStyle('western');
  });
  test('time uses 12-hour clock with ص/م', () => {
    assert.equal(formatTime(new Date(2026, 0, 1, 9, 5)), '9:05 ص');
    assert.equal(formatTime(new Date(2026, 0, 1, 12, 0)), '12:00 م');
    assert.equal(formatTime(new Date(2026, 0, 1, 0, 30)), '12:30 ص');
    assert.equal(formatTime(new Date(2026, 0, 1, 17, 30)), '5:30 م');
  });
  test('parseDateInput validates real dates', () => {
    assert.equal(parseDateInput('5/3/2026'), '2026-03-05');
    assert.equal(parseDateInput('٠٥/٠٣/٢٠٢٦'), '2026-03-05');
    assert.equal(parseDateInput('31/02/2026'), null);
    assert.equal(parseDateInput('2026-03-05'), null);
  });
  test('age', () => {
    const on = new Date(2026, 9, 21);
    assert.deepEqual(ageFromDOB('1990-10-22', on), { years: 35, months: 11 });
    assert.deepEqual(ageFromDOB('1990-10-21', on), { years: 36, months: 0 });
    assert.equal(formatAge('1990-10-21', on), '36 سنة');
    assert.equal(formatAge('2020-10-21', on), '6 سنوات');
    assert.equal(formatAge('2025-10-21', on), 'سنة');
    assert.equal(formatAge('2024-07-21', on), 'سنتان و3 أشهر');
    assert.equal(formatAge('2026-02-21', on), '8 أشهر');
    assert.equal(formatAge('2027-01-01', on), '—');
  });
  test('percent and bytes', () => {
    assert.equal(formatPercent(87.86), '87.9%');
    assert.equal(formatBytes(1536), '1.5 ك.ب');
  });
});
